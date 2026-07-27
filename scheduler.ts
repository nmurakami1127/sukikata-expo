// スキかた - 通知スケジューリングのコアロジック
// UIやOS APIに依存しない純粋関数として実装し、テストしやすくする。

import {
  DAILY_MESSAGES,
  AFTER_REST_MESSAGE_ID,
  ONBOARDING_FOLLOWUP_COPY,
} from './messages';
import {
  NotificationDecision,
  NotificationSettings,
  UserActivityState,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * 日次リマインドの文言を選ぶ。
 * ルール:
 *  - 直近に未実施日があった翌日は「昨日はお休みでも大丈夫」を優先表示
 *  - それ以外は、直近3日以内に使っていない文言からランダムに選ぶ
 *    （3日連続で同じ文言を出さないため）
 */
export function pickDailyMessage(
  today: string,
  state: UserActivityState
): { id: string; text: string } {
  const hadRecentInactiveDay =
    state.lastActivityDate !== null &&
    daysBetween(state.lastActivityDate, today) >= 2; // 前日が未実施だった場合

  if (hadRecentInactiveDay) {
    const afterRest = DAILY_MESSAGES.find((m) => m.id === AFTER_REST_MESSAGE_ID)!;
    return { id: afterRest.id, text: afterRest.text };
  }

  // 直近3日で使った文言IDは除外候補にする
  const recentlyUsed = new Set(state.recentDailyMessageIds.slice(0, 2));
  const candidates = DAILY_MESSAGES.filter(
    (m) => m.id !== AFTER_REST_MESSAGE_ID && !recentlyUsed.has(m.id)
  );
  const pool = candidates.length > 0
    ? candidates
    : DAILY_MESSAGES.filter((m) => m.id !== AFTER_REST_MESSAGE_ID);

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return { id: chosen.id, text: chosen.text };
}

/**
 * その日に送るべき通知を1件だけ判定する。
 * 優先順位:
 *   1. 未起動ユーザー向け初回フォロー（Day1 / Day3）
 *   2. 日次リマインド（設定onかつ未起動ユーザーでない場合）
 *   3. 休眠再喚起（7日 / 14日）※日次リマインドと重複する場合は日次リマインド優先
 *   4. 該当なし
 * 1日1件ルールは呼び出し側で notificationSentToday を見て保証する想定だが、
 * この関数自体も1件しか返さない設計になっている。
 */
export function decideNotificationForToday(
  today: string,
  settings: NotificationSettings,
  state: UserActivityState
): NotificationDecision {
  if (state.notificationSentToday) {
    return { kind: 'none', body: null };
  }

  // マスタースイッチがオフなら、初回フォロー・日次・休眠再喚起すべて送らない
  if (!settings.notificationsEnabled) {
    return { kind: 'none', body: null };
  }

  // 「未起動」= 一度も recordAppOpen() が呼ばれていない（lastAppOpenDate が null）場合のみ。
  // インストール当日に実際にアプリを開いて使っている場合は、未起動として扱わない。
  const neverOpened = state.lastAppOpenDate === null;
  const daysSinceInstall = daysBetween(state.installDate, today);

  // 1. 未起動ユーザー向け初回フォロー（Day1 / Day3）
  if (neverOpened) {
    if (daysSinceInstall === 1 && !state.onboardingFollowupsSent.day1) {
      return {
        kind: 'onboarding_day1',
        body: ONBOARDING_FOLLOWUP_COPY.day1,
      };
    }
    if (daysSinceInstall === 3 && !state.onboardingFollowupsSent.day3) {
      return {
        kind: 'onboarding_day3',
        body: ONBOARDING_FOLLOWUP_COPY.day3,
      };
    }
    // 未起動ユーザーには日次リマインド・休眠再喚起は送らない
    return { kind: 'none', body: null };
  }

  // 2. 日次リマインド（マスタースイッチがオンなら送る。重なった場合はこちらを優先）
  const picked = pickDailyMessage(today, state);
  return { kind: 'daily_reminder', body: picked.text, messageId: picked.id };

  // ※ 休眠再喚起（7日/14日）は、日次リマインドが常に優先されるため
  // このマスタースイッチがオンの状態では実質発火しない。
  // 「日次リマインドだけオフにして再喚起だけ受け取りたい」という状態は
  // 今回の仕様（トグル1つのみ）には存在しないため、このステップは到達しない。
}

/**
 * decideNotificationForToday の結果を反映して、次回判定用に state を更新するヘルパー。
 * 実際の永続化（AsyncStorage等）は呼び出し側で行う。
 */
export function applyDecisionToState(
  state: UserActivityState,
  decision: NotificationDecision
): UserActivityState {
  if (decision.kind === 'none') return state;

  const next: UserActivityState = {
    ...state,
    notificationSentToday: true,
  };

  if (decision.kind === 'daily_reminder' && decision.messageId) {
    next.recentDailyMessageIds = [
      decision.messageId,
      ...state.recentDailyMessageIds,
    ].slice(0, 2); // 直近2件保持すれば3日連続判定に十分
  }
  if (decision.kind === 'onboarding_day1') {
    next.onboardingFollowupsSent = { ...state.onboardingFollowupsSent, day1: true };
  }
  if (decision.kind === 'onboarding_day3') {
    next.onboardingFollowupsSent = { ...state.onboardingFollowupsSent, day3: true };
  }
  if (decision.kind === 'dormant_7day') {
    next.dormantStageSent = 1;
  }
  if (decision.kind === 'dormant_14day') {
    next.dormantStageSent = 2;
  }

  return next;
}

// スキかた - 日次通知ジョブ
// バックグラウンドタスク（例: expo-background-fetch / expo-task-manager）
// またはアプリ起動時に、1日1回だけ呼び出すことを想定したエントリポイント。

import { decideNotificationForToday, applyDecisionToState } from './scheduler';
import {
  getOsNotificationPermissionStatus,
  loadNotificationSettings,
  loadUserActivityState,
  resetDailyFlagIfNewDay,
  saveUserActivityState,
  scheduleDailyNotification,
  todayString,
} from './storage';

const LAST_CHECKED_DATE_KEY = 'sukikata:notificationLastCheckedDate';

/**
 * その日の通知内容を判定し、OS許可があればスケジュールする。
 * 呼び出しタイミングの例:
 *  - アプリのフォアグラウンド復帰時
 *  - バックグラウンドタスク（1日1回、深夜など静かな時間帯に実行）
 *
 * @param force true の場合、「今日はもう内容を決めた（notificationSentToday）」という
 *   ガードを無視して必ず現在の設定で再スケジュールする。
 *   設定画面でユーザーがオン/オフや時刻を直接変更したときは、
 *   その変更を確実に反映させたいので force=true で呼び出す。
 *   バックグラウンドの定期実行など「様子を見に行くだけ」の呼び出しでは
 *   force=false（デフォルト）のままにし、1日1件ルールを守る。
 */
export async function runDailyNotificationJob(
  force: boolean = false
): Promise<void> {
  const permission = await getOsNotificationPermissionStatus();
  if (permission !== 'granted') return; // 許可がなければ何もしない

  const today = todayString();
  const settings = await loadNotificationSettings();

  let state = await loadUserActivityState();
  // 日付が変わっていたら「今日はまだ送っていない」状態に戻す
  const lastChecked = (globalThis as any).__sukikataLastChecked ?? today;
  state = resetDailyFlagIfNewDay(state, lastChecked, today);
  (globalThis as any).__sukikataLastChecked = today;

  const decisionState = force ? { ...state, notificationSentToday: false } : state;
  const decision = decideNotificationForToday(today, settings, decisionState);
  if (decision.kind === 'none' || decision.body === null) {
    await saveUserActivityState(state);
    return;
  }

  await scheduleDailyNotification(settings.reminderTime, decision.body);

  const nextState = applyDecisionToState(state, decision);
  await saveUserActivityState(nextState);
}

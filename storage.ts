// スキかた - 通知状態の永続化 & OS通知APIラッパー
// expo-notifications を利用する前提。Bare React Native の場合は
// Notifee 等に差し替え可能なよう、OS依存部分をこのファイルに閉じ込めている。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_ROBOT_VACUUM_PREFERENCES,
  NotificationSettings,
  RobotVacuumPreferences,
  RobotVacuumStatus,
  TaskStats,
  UserActivityState,
} from './types';

// アプリ起動時に一度だけ設定される、フォアグラウンド時の通知の見せ方。
// これが無いと、アプリを開いている間に通知が来ても何も表示されないことがある。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ANDROID_CHANNEL_ID = 'sukikata-daily';
const ANDROID_TIMER_CHANNEL_ID = 'sukikata-timer';

/** Androidは通知チャンネルを作らないと通知が届かない/鳴らないことがある */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'スキかた 日次リマインド',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

export async function ensureAndroidTimerNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_TIMER_CHANNEL_ID, {
    name: 'スキかた タイマー終了',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

const SETTINGS_KEY = 'sukikata:notificationSettings';
const ACTIVITY_STATE_KEY = 'sukikata:userActivityState';

export async function loadNotificationSettings(): Promise<NotificationSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
  try {
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function saveNotificationSettings(
  settings: NotificationSettings
): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function todayString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function loadUserActivityState(): Promise<UserActivityState> {
  const raw = await AsyncStorage.getItem(ACTIVITY_STATE_KEY);
  if (raw) {
    try {
      const parsed: UserActivityState = JSON.parse(raw);
      // 日付が変わっていたら notificationSentToday をリセット
      if (parsed.lastAppOpenDate !== todayString()) {
        // no-op here; リセット判定は呼び出し側の resetDailyFlagIfNewDay で行う
      }
      return parsed;
    } catch {
      // fallthrough to初期化
    }
  }
  const today = todayString();
  const initial: UserActivityState = {
    installDate: today,
    // 「実際にアプリを開いた」ことは recordAppOpen() が呼ばれて初めて記録される。
    // ここを today にしてしまうと、インストール当日は
    // 「一度も開いていないユーザー」と区別できなくなってしまうため null にする。
    lastAppOpenDate: null,
    lastActivityDate: null,
    recentDailyMessageIds: [],
    dormantStageSent: 0,
    onboardingFollowupsSent: { day1: false, day3: false },
    notificationSentToday: false,
  };
  await AsyncStorage.setItem(ACTIVITY_STATE_KEY, JSON.stringify(initial));
  return initial;
}

export async function saveUserActivityState(
  state: UserActivityState
): Promise<void> {
  await AsyncStorage.setItem(ACTIVITY_STATE_KEY, JSON.stringify(state));
}

/** 日付が変わっていたら notificationSentToday を false に戻す */
export function resetDailyFlagIfNewDay(
  state: UserActivityState,
  lastCheckedDate: string,
  today: string
): UserActivityState {
  if (lastCheckedDate === today) return state;
  return { ...state, notificationSentToday: false };
}

/** アプリを開いたときに呼ぶ。起動日・実施日を更新する。 */
export async function recordAppOpen(): Promise<void> {
  const state = await loadUserActivityState();
  const next = { ...state, lastAppOpenDate: todayString() };
  await saveUserActivityState(next);
}

/** タスク完了 or Before/After撮影のとき呼ぶ。「実施日」を更新する。 */
export async function recordActivityDone(): Promise<void> {
  const state = await loadUserActivityState();
  const next = { ...state, lastActivityDate: todayString() };
  await saveUserActivityState(next);
}

// ---- OS通知API ----

export async function requestOsNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getOsNotificationPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

const DAILY_NOTIFICATION_ID_KEY = 'sukikata:dailyNotificationId';
const TIMER_NOTIFICATION_ID_KEY = 'sukikata:timerNotificationId';

/**
 * 指定した時刻(HH:mm)に毎日発火するローカル通知を1件だけスケジュールする。
 * 「毎日繰り返す」タイプのトリガーを使うため、アプリを開かない日でも届く。
 * 本文（ローテーション文言など）は、設定変更時やアプリ起動時に呼び直すことで更新される。
 *
 * 以前は cancelAllScheduledNotificationsAsync() で通知を全消ししてから積み直していたが、
 * それだとタイマー終了通知（別カテゴリ）まで巻き込んで消えてしまうため、
 * 自分（日次リマインド）が前回積んだ通知だけを ID 指定でキャンセルする方式にしている。
 */
export async function scheduleDailyNotification(
  time: string,
  body: string
): Promise<void> {
  await ensureAndroidNotificationChannel();

  const prevId = await AsyncStorage.getItem(DAILY_NOTIFICATION_ID_KEY);
  if (prevId) {
    await Notifications.cancelScheduledNotificationAsync(prevId).catch(() => {});
  }

  const [hour, minute] = time.split(':').map(Number);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'スキかた',
      body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
    },
  });
  await AsyncStorage.setItem(DAILY_NOTIFICATION_ID_KEY, id);
}

/** 通知のマスタースイッチをOFFにしたときなど、スキかたの通知をすべて消す */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await AsyncStorage.multiRemove([DAILY_NOTIFICATION_ID_KEY, TIMER_NOTIFICATION_ID_KEY]);
}

/**
 * 5分タイマー終了時に届く通知を、指定秒数後に1件だけ予約する（日次リマインドとは別カテゴリ）。
 * マスタースイッチ・タイマー通知トグルのいずれかがOFF、もしくはOS権限が未許可なら何もしない。
 * 一時停止・キャンセル・延長など、残り時間が変わるたびに呼び直される想定（内部で前回分を消してから積み直す）。
 */
export async function scheduleTimerCompletionNotification(
  secondsFromNow: number
): Promise<void> {
  const settings = await loadNotificationSettings();
  if (!settings.notificationsEnabled || !settings.timerCompletionEnabled) return;

  const status = await getOsNotificationPermissionStatus();
  if (status !== 'granted') return;

  await ensureAndroidTimerNotificationChannel();
  await cancelTimerCompletionNotification();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'スキかた',
      body: '5分、経ちました。つづけても、ここで終えても、どちらでも大丈夫。',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.round(secondsFromNow)),
      channelId: Platform.OS === 'android' ? ANDROID_TIMER_CHANNEL_ID : undefined,
    },
  });
  await AsyncStorage.setItem(TIMER_NOTIFICATION_ID_KEY, id);
}

/** 予約済みのタイマー終了通知があれば取り消す（一時停止・キャンセル・早期終了などで呼ぶ） */
export async function cancelTimerCompletionNotification(): Promise<void> {
  const id = await AsyncStorage.getItem(TIMER_NOTIFICATION_ID_KEY);
  if (!id) return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  await AsyncStorage.removeItem(TIMER_NOTIFICATION_ID_KEY);
}

/** 通知をタップしてアプリが開かれたときに呼ばれる */
export function addNotificationOpenedListener(callback: () => void) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

// ---- ロボット掃除機パーソナライズ（次期リリース） ----

const ROBOT_VACUUM_PREFERENCES_KEY = 'sukikata:robotVacuumPreferences';
const TASK_STATS_KEY = 'sukikata:taskStats';

/** 未設定ユーザー（新規キー未保存）は DEFAULT_ROBOT_VACUUM_PREFERENCES（unset）にフォールバックする */
export async function loadRobotVacuumPreferences(): Promise<RobotVacuumPreferences> {
  const raw = await AsyncStorage.getItem(ROBOT_VACUUM_PREFERENCES_KEY);
  if (!raw) return DEFAULT_ROBOT_VACUUM_PREFERENCES;
  try {
    return { ...DEFAULT_ROBOT_VACUUM_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_ROBOT_VACUUM_PREFERENCES;
  }
}

export async function saveRobotVacuumPreferences(
  prefs: RobotVacuumPreferences
): Promise<void> {
  await AsyncStorage.setItem(ROBOT_VACUUM_PREFERENCES_KEY, JSON.stringify(prefs));
}

/**
 * 設定画面からの明示的な操作でロボット掃除機利用状況を変更する（「未設定に戻す」も含む）。
 * robotVacuumStatus / robotVacuumStatusUpdatedAt のみを更新し、
 * ホーム画面バナーの再表示制御用状態（robotPromptDismissedAt,
 * floorCategoryUseCountSinceLastPrompt）やhiddenTaskIdsには一切触れない。
 * バナー側の「今は設定しない」（一時的にバナーを閉じる操作）とは独立した状態として扱うため。
 */
export function updateRobotVacuumStatus(
  prefs: RobotVacuumPreferences,
  status: RobotVacuumStatus,
  now: Date = new Date()
): RobotVacuumPreferences {
  return {
    ...prefs,
    robotVacuumStatus: status,
    robotVacuumStatusUpdatedAt: now.toISOString(),
  };
}

// ---- ホーム画面バナー（補助案内）の表示条件・再表示ロジック（実装指示書2-2） ----

/**
 * 「床」カテゴリの利用回数がこの回数に達したら初回案内バナーを表示候補にする（暫定値）。
 * 実装指示書7章の要確認事項に明記されている通り確定値ではないため、PM確認前提で定数化する。
 */
export const FLOOR_PROMPT_THRESHOLD = 3;

/**
 * 「今は設定しない」を選んだ後、バナーを再表示しない期間（日数）。要求定義4-2に明記された値。
 */
const ROBOT_PROMPT_DISMISS_DAYS = 30;

function daysSinceIso(isoDateString: string, now: Date): number {
  const then = new Date(isoDateString).getTime();
  return Math.floor((now.getTime() - then) / 86400000);
}

/**
 * 「床」カテゴリを選んだときに呼ぶ。floorCategoryUseCountSinceLastPromptを
 * 状況に応じて更新する（型定義のコメントに記載の通り、この1つのカウンタを2つの用途で使い回す）。
 *
 * - robotVacuumStatusがunset以外（owner/considering確定後）：バナー自体を出さないため更新しない
 * - 用途A（robotPromptDismissedAtがnull、初回案内前）：選ぶたびに+1
 * - 用途B（「今は設定しない」後）：ROBOT_PROMPT_DISMISS_DAYS+1日目（=31日目）以降の利用のみ+1する
 *   （30日経過前のカウントアップは再表示判定に影響しないため行わない）
 */
export function recordFloorCategoryUse(
  prefs: RobotVacuumPreferences,
  now: Date = new Date()
): RobotVacuumPreferences {
  if (prefs.robotVacuumStatus !== 'unset') return prefs;

  if (prefs.robotPromptDismissedAt !== null) {
    const days = daysSinceIso(prefs.robotPromptDismissedAt, now);
    if (days <= ROBOT_PROMPT_DISMISS_DAYS) return prefs;
  }

  return {
    ...prefs,
    floorCategoryUseCountSinceLastPrompt: prefs.floorCategoryUseCountSinceLastPrompt + 1,
  };
}

/**
 * ホーム画面バナーで「今は設定しない」を選んだときに呼ぶ。
 * robotPromptDismissedAtを現在日時に更新し、floorCategoryUseCountSinceLastPromptを0にリセットする
 * （用途Aから用途Bへの切り替え、または用途Bの再開始）。robotVacuumStatus/hiddenTaskIdsには触れない。
 */
export function dismissRobotPrompt(
  prefs: RobotVacuumPreferences,
  now: Date = new Date()
): RobotVacuumPreferences {
  return {
    ...prefs,
    robotPromptDismissedAt: now.toISOString(),
    floorCategoryUseCountSinceLastPrompt: 0,
  };
}

/**
 * ホーム画面バナーを表示すべきかどうかを判定する（実装指示書2-2）。
 * dismissedThisSessionは「バナーを単に閉じた」場合の同一セッション内抑制で、
 * 永続化しないセッション限りの状態としてApp.js側（UI層）が保持する想定。
 *
 * 表示禁止タイミング（タスク表示直前/実行中/タイマー終了時/完了直後/褒めメッセージ表示中）は
 * この関数の責務ではない。呼び出し側（ホーム画面レンダリング時のみ呼ぶ）で担保すること。
 */
export function shouldShowRobotPrompt(
  prefs: RobotVacuumPreferences,
  dismissedThisSession: boolean,
  now: Date = new Date()
): boolean {
  if (dismissedThisSession) return false;
  if (prefs.robotVacuumStatus !== 'unset') return false;

  if (prefs.robotPromptDismissedAt === null) {
    return prefs.floorCategoryUseCountSinceLastPrompt >= FLOOR_PROMPT_THRESHOLD;
  }

  const days = daysSinceIso(prefs.robotPromptDismissedAt, now);
  if (days <= ROBOT_PROMPT_DISMISS_DAYS) return false;

  return prefs.floorCategoryUseCountSinceLastPrompt >= 1;
}

/**
 * 「このタスクは今後出さない」を選択したときに呼ぶ。指定タスクIDをhiddenTaskIdsに追加する
 * （重複追加はしない）。それ以外のフィールドには触れない。
 */
export function hideTask(
  prefs: RobotVacuumPreferences,
  taskId: string
): RobotVacuumPreferences {
  if (prefs.hiddenTaskIds.includes(taskId)) return prefs;
  return { ...prefs, hiddenTaskIds: [...prefs.hiddenTaskIds, taskId] };
}

/**
 * 設定画面の「出さない設定にしたタスク」一覧から解除するときに呼ぶ。
 * 指定タスクIDをhiddenTaskIdsから取り除く。候補不足を理由にアプリ側が自動的に
 * 呼び出すことはない（実装指示書2-6：自動解除はしない）。
 */
export function unhideTask(
  prefs: RobotVacuumPreferences,
  taskId: string
): RobotVacuumPreferences {
  return {
    ...prefs,
    hiddenTaskIds: prefs.hiddenTaskIds.filter((id) => id !== taskId),
  };
}

export async function loadTaskStats(): Promise<TaskStats> {
  const raw = await AsyncStorage.getItem(TASK_STATS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function saveTaskStats(stats: TaskStats): Promise<void> {
  await AsyncStorage.setItem(TASK_STATS_KEY, JSON.stringify(stats));
}

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

// スキかた - 通知関連の型定義

/** 通知設定（設定画面でユーザーが変更する内容） */
export interface NotificationSettings {
  /**
   * 通知のマスタースイッチ。false の場合、日次リマインドだけでなく
   * 初回フォロー（Day1/Day3）・休眠再喚起（7日/14日）もすべて送信しない。
   */
  notificationsEnabled: boolean;
  /** 通知時刻（24h表記, 例: "19:00"）。日次リマインドに使用 */
  reminderTime: string; // "HH:mm"
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notificationsEnabled: true,
  reminderTime: '19:00',
};

/** 通知判定に必要なユーザーの利用状況スナップショット */
export interface UserActivityState {
  /** インストール日 (YYYY-MM-DD) */
  installDate: string;
  /** 最後にアプリを開いた日 (YYYY-MM-DD)。未起動なら installDate と同じか null */
  lastAppOpenDate: string | null;
  /** 最後にタスク完了 or Before/After撮影で「実施日」となった日 (YYYY-MM-DD) */
  lastActivityDate: string | null;
  /** 直近3日間に実際に送信した日次リマインドの文言ID履歴（新しい順） */
  recentDailyMessageIds: string[];
  /** これまでに送信した休眠再喚起の段階 (0=未送信, 1=7日分送信済み, 2=14日分送信済み=打ち切り) */
  dormantStageSent: 0 | 1 | 2;
  /** Day1/Day3の初回フォローを送信済みかどうか */
  onboardingFollowupsSent: {
    day1: boolean;
    day3: boolean;
  };
  /** 今日すでに何らかの通知を送信済みか（1日1件ルールの担保） */
  notificationSentToday: boolean;
}

/** 通知の種類 */
export type NotificationKind =
  | 'daily_reminder'
  | 'onboarding_day1'
  | 'onboarding_day3'
  | 'dormant_7day'
  | 'dormant_14day'
  | 'none';

export interface NotificationDecision {
  kind: NotificationKind;
  /** 送信する本文。kind が 'none' の場合は null */
  body: string | null;
  /** 日次リマインドの場合、選ばれた文言のID（履歴管理・3日連続回避のため） */
  messageId?: string;
}

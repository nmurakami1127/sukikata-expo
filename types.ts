// スキかた - 通知関連の型定義

/** 通知設定（設定画面でユーザーが変更する内容） */
export interface NotificationSettings {
  /**
   * 通知のマスタースイッチ。false の場合、日次リマインドだけでなく
   * 初回フォロー（Day1/Day3）・休眠再喚起（7日/14日）・タイマー終了通知もすべて送信しない。
   */
  notificationsEnabled: boolean;
  /** 通知時刻（24h表記, 例: "19:00"）。日次リマインドに使用 */
  reminderTime: string; // "HH:mm"
  /**
   * 5分タイマー終了時の通知。日次リマインドとは別カテゴリ・別トグルで、
   * 1日1件ルールの対象外（タイマーを使うたびに届く想定）。
   */
  timerCompletionEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notificationsEnabled: true,
  reminderTime: '19:00',
  timerCompletionEnabled: true,
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

// ---- ロボット掃除機パーソナライズ（次期リリース） ----

/**
 * ロボット掃除機の利用状況。3値のみで「使用予定なし」は持たない
 * （要求定義4章：明示的な「使わない」回答は必須としないため）。
 */
export type RobotVacuumStatus = 'owner' | 'considering' | 'unset';

export interface RobotVacuumPreferences {
  robotVacuumStatus: RobotVacuumStatus;
  /** robotVacuumStatus を最後に変更した日時 (ISO8601)。未変更なら null */
  robotVacuumStatusUpdatedAt: string | null;
  /**
   * ホーム画面バナーで「今は設定しない」を選んだ日時 (ISO8601)。
   * 選んだことが無ければ null。30日再表示抑制の起点として使う
   * （このフィールド自体は floorCategoryUseCountSinceLastPrompt のリセットとは独立して保持し続ける）。
   */
  robotPromptDismissedAt: string | null;
  /**
   * 「床」カテゴリの利用回数カウンタ。以下の2つの局面で使い回す、単一のカウンタ:
   *
   * 用途A（初回案内前）: robotVacuumStatus が 'unset' かつ robotPromptDismissedAt が null の間、
   *   床カテゴリを選ぶたびに +1 する。FLOOR_PROMPT_THRESHOLD に到達したらバナー表示候補にする。
   *
   * 用途B（「今は設定しない」後の再表示判定）: 「今は設定しない」選択と同時に 0 にリセットし、
   *   robotPromptDismissedAt から30日経過後、床カテゴリを選ぶたびに +1 する
   *   （30日経過前のカウントアップは再表示判定に影響しないため行わない）。
   *   1以上になった時点で次回ホーム画面で再表示候補とする
   *   （要求定義4-2：「30日経過後に床カテゴリを再度利用した場合に限り再表示候補とする」）。
   *
   * リセットタイミングまとめ:
   * - 「今は設定しない」を選択した瞬間 → 0 にリセット（用途Aから用途Bへ切り替わる）
   * - 再表示バナーに対してユーザーが何らかの回答をした（設定した／再度「今は設定しない」を選んだ）瞬間
   *   → 0 にリセットし、再度その時点の状態に応じて用途A or 用途Bとして使い回す
   * - robotVacuumStatus が 'owner' / 'considering' に確定した後は参照されない（バナー自体を出さないため）
   */
  floorCategoryUseCountSinceLastPrompt: number;
  /** ユーザーが「このタスクは今後出さない」を選んだタスクIDの一覧。アプリ側から自動解除しない */
  hiddenTaskIds: string[];
}

export const DEFAULT_ROBOT_VACUUM_PREFERENCES: RobotVacuumPreferences = {
  robotVacuumStatus: 'unset',
  robotVacuumStatusUpdatedAt: null,
  robotPromptDismissedAt: null,
  floorCategoryUseCountSinceLastPrompt: 0,
  hiddenTaskIds: [],
};

/** タスクごとの表示・完了・スキップ実績（暗黙の重み付けに使用。AIは使わない） */
export interface TaskStatEntry {
  shownCount: number;
  completedCount: number;
  skippedCount: number;
  /** 最後にこのタスクを表示した日時 (ISO8601)。未表示なら null */
  lastShownAt: string | null;
}

export type TaskStats = Record<string, TaskStatEntry>;

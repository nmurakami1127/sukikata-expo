// スキかた - 利用状況の匿名集計（Aptabase）
// 個人を特定できる情報・広告識別子は一切送信しない。イベント名と最小限の数値・文字列のみ。
// https://aptabase.com

import Aptabase, { trackEvent } from '@aptabase/react-native';

const APP_KEY = 'A-US-3888201129';

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  try {
    Aptabase.init(APP_KEY, { appVersion: '1.0.0' });
    initialized = true;
  } catch {
    // 集計できなくてもアプリ本体の動作は止めない
  }
}

export function trackTaskCompleted(kind: 'complete' | 'early' | 'quick'): void {
  try {
    trackEvent('task_completed', { kind });
  } catch {
    // no-op
  }
}

export function trackTaskSkipped(): void {
  try {
    trackEvent('task_skipped');
  } catch {
    // no-op
  }
}

export function trackStreakDay(days: number): void {
  try {
    trackEvent('streak_day', { days });
  } catch {
    // no-op
  }
}

export function trackNotificationOpened(): void {
  try {
    trackEvent('notification_opened');
  } catch {
    // no-op
  }
}

// ---- ロボット掃除機パーソナライズ（次期リリース、実装指示書4章） ----
// 個人を特定できる情報・タスクID・タスクタイトル・端末情報は送らない。

export function trackRobotStatusSet(status: 'owner' | 'considering' | 'unset'): void {
  try {
    trackEvent('robot_status_set', { status });
  } catch {
    // no-op
  }
}

export function trackRobotPromptShown(): void {
  try {
    trackEvent('robot_prompt_shown');
  } catch {
    // no-op
  }
}

export function trackRobotPromptDismissed(method: 'close' | 'dismiss_permanently'): void {
  try {
    trackEvent('robot_prompt_dismissed', { method });
  } catch {
    // no-op
  }
}

export function trackRobotTaskShown(): void {
  try {
    trackEvent('robot_task_shown');
  } catch {
    // no-op
  }
}

export function trackRobotTaskCompleted(): void {
  try {
    trackEvent('robot_task_completed');
  } catch {
    // no-op
  }
}

export function trackRobotTaskSkipped(): void {
  try {
    trackEvent('robot_task_skipped');
  } catch {
    // no-op
  }
}

export function trackTaskHidden(): void {
  try {
    trackEvent('task_hidden');
  } catch {
    // no-op
  }
}

export function trackTaskUnhidden(): void {
  try {
    trackEvent('task_unhidden');
  } catch {
    // no-op
  }
}

export function trackRobotShortcutOpened(): void {
  try {
    trackEvent('robot_shortcut_opened');
  } catch {
    // no-op
  }
}

export function trackTaskPoolFallback(reason: 'cooldown_exhausted' | 'hidden_exhausted'): void {
  try {
    trackEvent('task_pool_fallback', { reason });
  } catch {
    // no-op
  }
}

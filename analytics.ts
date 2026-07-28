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

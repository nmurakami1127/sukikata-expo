// スキかた - 連続実施日数（ストリーク）のシンプルな計算
// 通知機能側の UserActivityState（storage.ts）とは独立して管理する。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayString } from './storage';

const STREAK_KEY = 'sukikata:streak';

interface StreakState {
  currentStreak: number;
  lastActiveDate: string | null; // YYYY-MM-DD
}

async function loadStreakState(): Promise<StreakState> {
  const raw = await AsyncStorage.getItem(STREAK_KEY);
  if (!raw) return { currentStreak: 0, lastActiveDate: null };
  try {
    return JSON.parse(raw);
  } catch {
    return { currentStreak: 0, lastActiveDate: null };
  }
}

async function saveStreakState(state: StreakState): Promise<void> {
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(state));
}

function isYesterday(dateString: string, today: string): boolean {
  const a = new Date(`${dateString}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diffDays === 1;
}

/**
 * タスク完了などの「実施」があったときに呼ぶ。
 * 同じ日に複数回呼んでもストリークは1日分としてしか増えない。
 * 戻り値: 更新後の連続実施日数
 */
export async function recordActivityAndGetStreak(): Promise<number> {
  const today = todayString();
  const state = await loadStreakState();

  if (state.lastActiveDate === today) {
    return state.currentStreak;
  }

  const nextStreak =
    state.lastActiveDate && isYesterday(state.lastActiveDate, today)
      ? state.currentStreak + 1
      : 1;

  await saveStreakState({ currentStreak: nextStreak, lastActiveDate: today });
  return nextStreak;
}

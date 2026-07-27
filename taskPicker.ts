// スキかた - 場所ごとのタスク選定（cooldownDays 以内に出したタスクは避ける）

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TASKS, Task } from './taskData';
import { todayString } from './storage';

const HISTORY_KEY = 'sukikata:taskHistory';

type TaskHistory = Record<string, string>; // taskId -> 最後に出した日 (YYYY-MM-DD)

async function loadTaskHistory(): Promise<TaskHistory> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTaskHistory(history: TaskHistory): Promise<void> {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function daysSince(dateString: string, today: string): number {
  const a = new Date(`${dateString}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 指定カテゴリから、直近 cooldownDays 以内に出していないタスクをランダムに1件選ぶ。
 * 全タスクがクールダウン中の場合は、そのカテゴリ全体から選び直す（表示を止めないため）。
 */
export async function pickTaskForCategory(categoryId: string): Promise<Task> {
  const pool = TASKS[categoryId] ?? [];
  const history = await loadTaskHistory();
  const today = todayString();

  const eligible = pool.filter((t) => {
    const last = history[t.id];
    if (!last) return true;
    return daysSince(last, today) >= t.cooldownDays;
  });

  const chosen = pickRandom(eligible.length ? eligible : pool);

  await saveTaskHistory({ ...history, [chosen.id]: today });
  return chosen;
}

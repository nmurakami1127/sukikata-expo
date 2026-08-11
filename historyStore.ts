// スキかた - 実施履歴（テキストのみ）の記録
// 直近30日分だけを端末内に保持する。写真は含まない。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayString } from './storage';

const HISTORY_KEY = 'sukikata:history';
const RETENTION_DAYS = 30;

export interface HistoryEntry {
  date: string; // YYYY-MM-DD
  categoryId: string;
  categoryLabel: string;
  taskTitle: string;
}

async function loadHistory(): Promise<HistoryEntry[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function daysSince(dateString: string, today: string): number {
  const a = new Date(`${dateString}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export async function recordTaskCompletion(
  categoryId: string,
  categoryLabel: string,
  taskTitle: string
): Promise<void> {
  const history = await loadHistory();
  const today = todayString();
  const next = [
    { date: today, categoryId, categoryLabel, taskTitle },
    ...history,
  ].filter((e) => daysSince(e.date, today) < RETENTION_DAYS);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export interface HistoryDay {
  date: string;
  counts: { categoryId: string; categoryLabel: string; count: number }[];
}

/** 直近30日分を、日付ごと・カテゴリごとの件数にまとめて返す（新しい日付順） */
export async function getRecentHistoryByDay(): Promise<HistoryDay[]> {
  const history = await loadHistory();
  const byDate = new Map<string, Map<string, { categoryLabel: string; count: number }>>();

  for (const entry of history) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, new Map());
    const byCategory = byDate.get(entry.date)!;
    const existing = byCategory.get(entry.categoryId);
    byCategory.set(entry.categoryId, {
      categoryLabel: entry.categoryLabel,
      count: (existing?.count ?? 0) + 1,
    });
  }

  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, byCategory]) => ({
      date,
      counts: Array.from(byCategory.entries()).map(([categoryId, v]) => ({
        categoryId,
        categoryLabel: v.categoryLabel,
        count: v.count,
      })),
    }));
}

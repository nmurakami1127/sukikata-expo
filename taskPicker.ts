// スキかた - 場所ごとのタスク選定（cooldownDays 以内に出したタスクは避ける）

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TASKS, Task } from './taskData';
import { todayString } from './storage';
import { RobotVacuumStatus } from './types';

/**
 * owner/considering向けタスクの重みにかける倍率（暫定値）。
 * 「除外はしないが優先度を上げる」の度合いを決める定数で、実装指示書7章の
 * 要確認事項には明記が無いためPM確認前提の暫定値としてここに定数化する。
 */
export const ROBOT_AUDIENCE_WEIGHT_MULTIPLIER = 3;

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
 * カテゴリ内の全タスクが「今後出さない」設定で除外され、候補が0件になったときに投げる。
 * 実装指示書2-7（フォールバックロジック、ステップ6）のB.「今後出さない」による不足に
 * 対応するためのシグナル。ここでは自動解除・代替提示は行わない
 * （呼び出し側がこのエラーを捕捉して案内を出す設計は次のステップで対応する）。
 */
export class NoEligibleTaskError extends Error {
  constructor(categoryId: string) {
    super(`No eligible tasks in category "${categoryId}" after hiddenTaskIds exclusion`);
    this.name = 'NoEligibleTaskError';
  }
}

/** ユーザー属性から、優先すべきaudience値を返す。unsetの場合はnull（フィルタなし） */
function audienceForStatus(
  status: RobotVacuumStatus
): 'robot_owner' | 'robot_considering' | null {
  if (status === 'owner') return 'robot_owner';
  if (status === 'considering') return 'robot_considering';
  return null;
}

function effectiveWeight(task: Task, audience: 'robot_owner' | 'robot_considering'): number {
  const base = task.weight ?? 1;
  if (task.audiences?.includes(audience)) return base * ROBOT_AUDIENCE_WEIGHT_MULTIPLIER;
  return base;
}

/**
 * プールから1件選ぶ（cooldown等の絞り込みは行わない、純粋な選択処理）。
 *
 * robotVacuumStatus が 'unset' の場合は既存MVPと完全に同じ一様ランダム選択を行う
 * （audiences/weightは一切参照しない。実装指示書2-3の受け入れ条件「unsetユーザーの
 * 出力分布は現行MVPと変わらない」に対応）。
 *
 * 'owner'/'considering' の場合、該当audienceを持つタスクの重みを
 * ROBOT_AUDIENCE_WEIGHT_MULTIPLIER倍にした重み付きランダム選択を行う。
 * 除外ではないため、非該当タスクも通常タスクとして選ばれ続ける。
 */
export function selectWeightedTask(pool: Task[], robotVacuumStatus: RobotVacuumStatus): Task {
  const audience = audienceForStatus(robotVacuumStatus);
  if (!audience) return pickRandom(pool);

  const weights = pool.map((t) => effectiveWeight(t, audience));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1]; // 浮動小数点誤差で全減算しきれなかった場合のフォールバック
}

/**
 * 指定カテゴリから、直近 cooldownDays 以内に出していないタスクを1件選ぶ。
 * 全タスクがクールダウン中の場合は、そのカテゴリ全体から選び直す（表示を止めないため）。
 * excludeTaskId を指定すると、そのタスク以外から選ぶ（「ほかのかたづけをする」で
 * 同じタスクが連続して出るのを防ぐため）。カテゴリに1件しかない場合は無視される。
 * robotVacuumStatus を指定すると、該当ユーザー向けタスクの選択優先度が上がる
 * （省略時は 'unset' 扱いで既存MVPと同じ挙動）。
 * hiddenTaskIds を指定すると、「今後出さない」設定されたタスクを候補から除外する
 * （実装指示書2-3手順3）。この除外はcooldown枯渇時のフォールバックより優先されるため、
 * 全タスクがクールダウン中でも非表示タスクが再提示されることはない。
 * 非表示設定によって候補が0件になった場合は NoEligibleTaskError を投げる
 * （自動解除はしない。呼び出し側での案内表示は次のステップで対応）。
 */
export async function pickTaskForCategory(
  categoryId: string,
  excludeTaskId?: string,
  robotVacuumStatus: RobotVacuumStatus = 'unset',
  hiddenTaskIds: string[] = []
): Promise<Task> {
  const pool = TASKS[categoryId] ?? [];
  const visiblePool = pool.filter((t) => !hiddenTaskIds.includes(t.id));
  if (visiblePool.length === 0) {
    throw new NoEligibleTaskError(categoryId);
  }

  const history = await loadTaskHistory();
  const today = todayString();

  const notCoolingDown = visiblePool.filter((t) => {
    const last = history[t.id];
    if (!last) return true;
    return daysSince(last, today) >= t.cooldownDays;
  });

  let eligible = notCoolingDown.length ? notCoolingDown : visiblePool;
  if (excludeTaskId && eligible.length > 1) {
    eligible = eligible.filter((t) => t.id !== excludeTaskId);
  }

  const chosen = selectWeightedTask(eligible, robotVacuumStatus);

  await saveTaskHistory({ ...history, [chosen.id]: today });
  return chosen;
}

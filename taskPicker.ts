// スキかた - 場所ごとのタスク選定（cooldownDays 以内に出したタスクは避ける）

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TASKS, Task } from './taskData';
import {
  todayString,
  loadTaskStats,
  saveTaskStats,
  loadRobotVacuumPreferences,
  saveRobotVacuumPreferences,
  hideTask,
} from './storage';
import { RobotVacuumStatus, TaskStats } from './types';

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

/**
 * NoEligibleTaskError（実装指示書2-7・9-3 Bケース）発生時にUI側が表示する案内文言。
 * 圧をかけない表現・具体的な選択肢という指示書の文言をそのまま定数化し、
 * App.js側（Jestで直接テストできない）とテストの両方から同じ値を参照する。
 */
export const NO_ELIGIBLE_TASK_MESSAGE = '今出せるタスクが少なくなっています。';
export const NO_ELIGIBLE_TASK_OPTION_OTHER_PLACE = '他の場所を見る';
export const NO_ELIGIBLE_TASK_OPTION_REVIEW_HIDDEN = '出さない設定を見直す';

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
 * クールダウン枯渇時のフォールバック（実装指示書2-7・9-3 Aケース）専用の決定的な選択。
 * 通常選択（selectWeightedTask）とは別に、以下の優先順で1件を確定的に決める
 * （ランダム要素は使わない）：
 * 1. 最終実施日が古い（一度も表示していない場合を最優先＝最も古い扱い）
 * 2. スキップ率が低い（表示回数が0の場合は0%扱い）
 * 3. 表示回数が少ない
 * 全て同点の場合は候補配列の先頭（=カテゴリ内の元の並び順）を採用する。
 */
function rankForCooldownFallback(
  candidates: Task[],
  history: TaskHistory,
  stats: TaskStats
): Task {
  const scored = candidates.map((task) => {
    const lastShownDate = history[task.id] ?? ''; // 空文字列＝未実施。日付文字列より必ず小さい
    const entry = stats[task.id];
    const shownCount = entry?.shownCount ?? 0;
    const skippedCount = entry?.skippedCount ?? 0;
    const skipRate = shownCount > 0 ? skippedCount / shownCount : 0;
    return { task, lastShownDate, skipRate, shownCount };
  });

  scored.sort((a, b) => {
    if (a.lastShownDate !== b.lastShownDate) {
      return a.lastShownDate < b.lastShownDate ? -1 : 1;
    }
    if (a.skipRate !== b.skipRate) return a.skipRate - b.skipRate;
    return a.shownCount - b.shownCount;
  });

  return scored[0].task;
}

/**
 * 選択結果を暗黙の重み付け用の統計に記録する（実装指示書8-6）。
 * chosenのshownCountを+1しlastShownAtを更新。skippedTaskIdが指定されていれば
 * そのタスクのskippedCountを+1する（「別のタスクを見る」でスキップされた前回のタスク）。
 */
async function recordSelectionStats(
  chosenId: string,
  skippedTaskId: string | undefined
): Promise<void> {
  const stats = await loadTaskStats();
  const next: TaskStats = { ...stats };

  const chosenEntry = next[chosenId] ?? {
    shownCount: 0,
    completedCount: 0,
    skippedCount: 0,
    lastShownAt: null,
  };
  next[chosenId] = {
    ...chosenEntry,
    shownCount: chosenEntry.shownCount + 1,
    lastShownAt: new Date().toISOString(),
  };

  if (skippedTaskId) {
    const skippedEntry = next[skippedTaskId] ?? {
      shownCount: 0,
      completedCount: 0,
      skippedCount: 0,
      lastShownAt: null,
    };
    next[skippedTaskId] = {
      ...skippedEntry,
      skippedCount: skippedEntry.skippedCount + 1,
    };
  }

  await saveTaskStats(next);
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
 * （実装指示書2-7 Bケース。自動解除はしない。呼び出し側での案内表示は別途対応）。
 *
 * 候補が非表示ではないがカテゴリ内全件クールダウン中の場合（2-7 Aケース）は、
 * 通常の重み付きランダム選択ではなく rankForCooldownFallback による決定的な優先順位選択に切り替わる
 * （最終実施日→スキップ率→表示回数の順。この分岐では robotVacuumStatus による重み付けは適用しない）。
 *
 * audienceFilter を指定すると、カテゴリのタスクをそのaudienceを含むものだけに厳密フィルタ
 * してから以降の処理（cooldown・非表示除外・重み付け）を行う（実装指示書2-4のショートカット用）。
 * 新しいタスクリストを作るのではなく、TASKS[categoryId]をその場でフィルタしたビューとして
 * 扱うだけなので、専用データの複製は発生しない。
 *
 * 解釈メモ（実装指示書に明記が無いため記録）：通常の「床」カテゴリ選択ではaudiencesは
 * 除外ではなく重み付け（11章）に使うが、このショートカット導線に限っては「同じタスクプールを
 * 利用する」（6-2）を「robot_owner以外は出さない」という厳密フィルタとして読んでいる。
 * 11章の「除外ではなく共存」は通常の床カテゴリ選択の挙動を指すものと解釈し、
 * ショートカットという専用導線には別の解釈を採用している。
 */
export async function pickTaskForCategory(
  categoryId: string,
  excludeTaskId?: string,
  robotVacuumStatus: RobotVacuumStatus = 'unset',
  hiddenTaskIds: string[] = [],
  audienceFilter?: string
): Promise<Task> {
  const categoryPool = TASKS[categoryId] ?? [];
  const pool = audienceFilter
    ? categoryPool.filter((t) => t.audiences?.includes(audienceFilter))
    : categoryPool;
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

  let chosen: Task;
  if (notCoolingDown.length) {
    let eligible = notCoolingDown;
    if (excludeTaskId && eligible.length > 1) {
      eligible = eligible.filter((t) => t.id !== excludeTaskId);
    }
    chosen = selectWeightedTask(eligible, robotVacuumStatus);
  } else {
    // Aケース：非表示ではない候補はあるが全件クールダウン中 → 優先順位に基づき決定的に選ぶ
    let candidates = visiblePool;
    if (excludeTaskId && candidates.length > 1) {
      candidates = candidates.filter((t) => t.id !== excludeTaskId);
    }
    const stats = await loadTaskStats();
    chosen = rankForCooldownFallback(candidates, history, stats);
  }

  await saveTaskHistory({ ...history, [chosen.id]: today });
  await recordSelectionStats(chosen.id, excludeTaskId);
  return chosen;
}

/**
 * 「このタスクは今後出さない」選択時の一連の処理（実装指示書2-6）。
 * taskIdToHideをhiddenTaskIdsに追加して永続化したうえで、同じカテゴリから代わりの
 * タスクを1件取得する。保存は代替タスクの取得より先に行うため、カテゴリ内の候補が
 * 尽きて NoEligibleTaskError が投げられた場合でも「非表示にする」設定自体は残る
 * （自動解除しない）。
 */
export async function hideTaskAndPickReplacement(
  categoryId: string,
  taskIdToHide: string,
  audienceFilter?: string
): Promise<Task> {
  const prefs = await loadRobotVacuumPreferences();
  const nextPrefs = hideTask(prefs, taskIdToHide);
  await saveRobotVacuumPreferences(nextPrefs);

  return pickTaskForCategory(
    categoryId,
    taskIdToHide,
    nextPrefs.robotVacuumStatus,
    nextPrefs.hiddenTaskIds,
    audienceFilter
  );
}

/**
 * ショートカット「ロボット掃除機前の5分」専用の薄いラッパー（実装指示書2-4）。
 * 「床」カテゴリと同一のタスクデータを、audiencesにrobot_ownerを含むものだけに
 * 厳密フィルタしたビューとして参照する。専用のタスクリストは持たない
 * （pickTaskForCategoryのaudienceFilter経由でTASKS.floorをその場でフィルタするのみ）。
 */
export async function pickRobotOwnerFloorTask(
  excludeTaskId?: string,
  hiddenTaskIds: string[] = []
): Promise<Task> {
  return pickTaskForCategory('floor', excludeTaskId, 'owner', hiddenTaskIds, 'robot_owner');
}

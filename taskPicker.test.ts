// 現行のランダム選択ロジック（cooldownDaysベース）の回帰テスト。
// ステップ2でtaskPicker.tsに属性フィルタ・重み付けを追加する前に、
// 現状の挙動をこのテストで固定しておく。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { pickTaskForCategory, selectWeightedTask } from './taskPicker';
import { TASKS, Task } from './taskData';
import { todayString } from './storage';

// taskPicker.ts内部の履歴保存キー（非公開）。テストでの直接検証のためここに複製する。
const HISTORY_KEY = 'sukikata:taskHistory';

function daysAgoString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayString(d);
}

describe('pickTaskForCategory（現行ランダム選択ロジックの回帰テスト）', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('履歴が無い場合、カテゴリ内のいずれかのタスクを返し、履歴に選択日を記録する', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const chosen = await pickTaskForCategory('desk');

    expect(chosen).toEqual(TASKS.desk[0]);

    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const history = JSON.parse(raw as string);
    expect(history[chosen.id]).toBe(todayString());
  });

  it('cooldown期間内のタスクは候補から除外される', async () => {
    const [first, second] = TASKS.desk;
    // first は昨日選択済み（cooldownDays=14未満）→ 候補から除外されるはず
    await AsyncStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ [first.id]: daysAgoString(1) })
    );
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const chosen = await pickTaskForCategory('desk');

    expect(chosen.id).not.toBe(first.id);
    expect(chosen.id).toBe(second.id);
  });

  it('カテゴリ内全タスクがcooldown中の場合は、表示を止めずカテゴリ全体から選び直す', async () => {
    const historyEntries: Record<string, string> = {};
    for (const t of TASKS.desk) {
      historyEntries[t.id] = daysAgoString(1);
    }
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const chosen = await pickTaskForCategory('desk');

    expect(chosen).toEqual(TASKS.desk[0]);
  });

  it('excludeTaskIdを指定すると、プールに2件以上あれば同じタスクは選ばれない', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const excludeId = TASKS.desk[0].id;

    const chosen = await pickTaskForCategory('desk', excludeId);

    expect(chosen.id).not.toBe(excludeId);
  });
});

// ステップ2: ロボット掃除機属性フィルタ（実装指示書2-3）のテスト。
// selectWeightedTask はcooldown/履歴処理から切り離した純粋関数として実装する想定
// （プールとユーザー属性から1件選ぶ部分だけを取り出し、単体テストしやすくする）。
const SAMPLE_POOL: Task[] = [
  { id: 'normal_1', title: '通常タスク1', note: '', cooldownDays: 14 },
  { id: 'normal_2', title: '通常タスク2', note: '', cooldownDays: 14 },
  { id: 'normal_3', title: '通常タスク3', note: '', cooldownDays: 14 },
  {
    id: 'robot_1',
    title: 'ロボット掃除機向けタスク1',
    note: '',
    cooldownDays: 14,
    audiences: ['robot_owner', 'robot_considering'],
  },
  {
    id: 'robot_2',
    title: 'ロボット掃除機向けタスク2',
    note: '',
    cooldownDays: 14,
    audiences: ['robot_owner', 'robot_considering'],
  },
];

/**
 * テスト専用の決定的擬似乱数生成器（mulberry32）。
 * モンテカルロ試行を実際のMath.randomに依存させると再現性が無くCIがflakyになりうるため、
 * 同じseedなら常に同じ乱数列を返すこの関数でMath.randomを差し替えて使う。
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('selectWeightedTask（実装指示書2-3：属性フィルタの受け入れ条件）', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('robotVacuumStatus が unset の場合', () => {
    it('audiences・weightを無視し、現行と同じ一様ランダム選択になる（出力分布が変わらないことの決定的検証）', () => {
      // 現行の pickRandom は arr[Math.floor(Math.random() * arr.length)]。
      // unset の場合はこれと完全に同一の選ばれ方になることを、
      // audiences混在プールに対しても確認する（属性フィルタが一切効かないことの検証）。
      const randomValues = [0, 0.15, 0.35, 0.55, 0.75, 0.99];
      for (const r of randomValues) {
        jest.spyOn(Math, 'random').mockReturnValue(r);
        const expected = SAMPLE_POOL[Math.floor(r * SAMPLE_POOL.length)];

        const chosen = selectWeightedTask(SAMPLE_POOL, 'unset');

        expect(chosen).toEqual(expected);
        jest.restoreAllMocks();
      }
    });
  });

  describe.each([
    ['owner', 'robot_owner'] as const,
    ['considering', 'robot_considering'] as const,
  ])('robotVacuumStatus が %s の場合', (status, matchingAudience) => {
    it('該当タスクの選択確率は通常タスクより高くなるが、除外ではないため0%にも100%にもならない', () => {
      const TRIALS = 2000;
      // seedを固定し、実行のたびに同じ乱数列で判定する（flaky回避のため実際のMath.randomは使わない）
      jest.spyOn(Math, 'random').mockImplementation(mulberry32(20260908));
      const counts: Record<string, number> = {};
      for (const t of SAMPLE_POOL) counts[t.id] = 0;

      for (let i = 0; i < TRIALS; i++) {
        const chosen = selectWeightedTask(SAMPLE_POOL, status);
        counts[chosen.id] += 1;
      }

      // 除外ではないこと：プール内の全タスク（属性に合わないものも含む）が最低1回は選ばれる
      for (const t of SAMPLE_POOL) {
        expect(counts[t.id]).toBeGreaterThan(0);
      }

      const matchingCount = SAMPLE_POOL.filter((t) =>
        t.audiences?.includes(matchingAudience)
      ).reduce((sum, t) => sum + counts[t.id], 0);
      const nonMatchingCount = TRIALS - matchingCount;

      // 0%にならない（通常タスクも一定数選ばれ続ける = 完全に置き換わらない）
      expect(nonMatchingCount).toBeGreaterThan(0);
      // 100%にならない（該当タスクがプールを独占しない）
      expect(matchingCount).toBeLessThan(TRIALS);

      // 重み付けが機能している：一様ランダム時の期待値（5件中2件=40%）より高い頻度で選ばれる
      const uniformBaselineShare =
        SAMPLE_POOL.filter((t) => t.audiences?.includes(matchingAudience)).length /
        SAMPLE_POOL.length;
      expect(matchingCount / TRIALS).toBeGreaterThan(uniformBaselineShare);
    });
  });
});

// 現行のランダム選択ロジック（cooldownDaysベース）の回帰テスト。
// ステップ2でtaskPicker.tsに属性フィルタ・重み付けを追加する前に、
// 現状の挙動をこのテストで固定しておく。

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  pickTaskForCategory,
  selectWeightedTask,
  NoEligibleTaskError,
  hideTaskAndPickReplacement,
  NO_ELIGIBLE_TASK_MESSAGE,
  NO_ELIGIBLE_TASK_OPTION_OTHER_PLACE,
  NO_ELIGIBLE_TASK_OPTION_REVIEW_HIDDEN,
} from './taskPicker';
import { TASKS, Task } from './taskData';
import {
  todayString,
  loadTaskStats,
  saveTaskStats,
  loadRobotVacuumPreferences,
} from './storage';
import { TaskStats } from './types';

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

// ステップ5: 「今後出さない」（実装指示書2-6、選択ロジック手順3のhiddenTaskIds除外）のテスト。
describe('pickTaskForCategory（hiddenTaskIdsによる除外・実装指示書2-6）', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('hiddenTaskIdsに含まれるタスクは選ばれない', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const [hidden, ...rest] = TASKS.desk;

    const chosen = await pickTaskForCategory('desk', undefined, 'unset', [hidden.id]);

    // 除外後の先頭（rest[0]）が選ばれるはず
    expect(chosen.id).toBe(rest[0].id);
    expect(chosen.id).not.toBe(hidden.id);
  });

  it('cooldown枯渇によるフォールバックでも、非表示タスクは再提示されない（受け入れ条件）', async () => {
    // desk全件をcooldown中にしておく → 通常なら「カテゴリ全体から選び直す」フォールバックが働く
    const historyEntries: Record<string, string> = {};
    for (const t of TASKS.desk) {
      historyEntries[t.id] = daysAgoString(1);
    }
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const [hidden, ...rest] = TASKS.desk;

    const chosen = await pickTaskForCategory('desk', undefined, 'unset', [hidden.id]);

    // フォールバック先は「非表示を除いたプール」であるべきで、元の全件プールに戻ってはいけない
    expect(chosen.id).not.toBe(hidden.id);
    expect(chosen.id).toBe(rest[0].id);
  });

  it('通常のスキップ（excludeTaskIdのみ）はhiddenTaskIdsに影響しない：別呼び出しでは再び選ばれうる', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const target = TASKS.desk[0];

    // 1回目：targetを除外して選ぶ（「ほかのかたづけをする」相当。hiddenTaskIdsは空のまま）
    const first = await pickTaskForCategory('desk', target.id, 'unset', []);
    expect(first.id).not.toBe(target.id);

    // 2回目：excludeTaskIdを指定しない通常選択では、targetも候補に戻る
    // （Math.random(0)で先頭が選ばれる設定なので、targetが再び候補プールの先頭であれば選ばれるはず）
    const second = await pickTaskForCategory('desk', undefined, 'unset', []);
    expect(second.id).toBe(target.id);
  });

  it('カテゴリ内全タスクが非表示の場合はNoEligibleTaskErrorを投げる（候補プール完全枯渇）', async () => {
    const allIds = TASKS.desk.map((t) => t.id);

    await expect(
      pickTaskForCategory('desk', undefined, 'unset', allIds)
    ).rejects.toThrow(NoEligibleTaskError);
  });
});

// ステップ6: クールダウン枯渇時のフォールバック優先順位（実装指示書2-7・9-3 Aケース）のテスト。
// 「全タスクがクールダウン中」の場合、1.最終実施日が古い 2.スキップ率が低い
// 3.表示回数が少ない、の優先順で1件を決定的に選ぶ（ランダム選択ではない）。
describe('pickTaskForCategory（クールダウン枯渇時のフォールバック優先順位・Aケース）', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('最終実施日が最も古いタスクが優先される', async () => {
    // desk全5件をcooldown中にする（cooldownDays=14未満）が、実施日はそれぞれ異なる
    const historyEntries: Record<string, string> = {
      desk_001: daysAgoString(1),
      desk_002: daysAgoString(5),
      desk_003: daysAgoString(10),
      desk_004: daysAgoString(2),
      desk_005: daysAgoString(13), // 最も古い → 優先されるはず
    };
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));

    const chosen = await pickTaskForCategory('desk');

    expect(chosen.id).toBe('desk_005');
  });

  it('最終実施日が同じ場合はスキップ率が低いタスクが優先される', async () => {
    const historyEntries: Record<string, string> = {};
    for (const t of TASKS.desk) historyEntries[t.id] = daysAgoString(1);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));

    // 全5件に明示的な統計を与える（未設定のタスクはskipRateが既定0扱いになり、
    // 意図せず「desk_002より低いスキップ率」として比較に混ざってしまうのを防ぐため）
    const stats: TaskStats = {
      desk_001: { shownCount: 10, completedCount: 0, skippedCount: 8, lastShownAt: null }, // skipRate 0.8
      desk_002: { shownCount: 10, completedCount: 0, skippedCount: 2, lastShownAt: null }, // skipRate 0.2 → 優先
      desk_003: { shownCount: 10, completedCount: 0, skippedCount: 5, lastShownAt: null }, // skipRate 0.5
      desk_004: { shownCount: 10, completedCount: 0, skippedCount: 9, lastShownAt: null }, // skipRate 0.9
      desk_005: { shownCount: 10, completedCount: 0, skippedCount: 4, lastShownAt: null }, // skipRate 0.4
    };
    await saveTaskStats(stats);

    const chosen = await pickTaskForCategory('desk');

    expect(chosen.id).toBe('desk_002');
  });

  it('最終実施日・スキップ率が同じ場合は表示回数が少ないタスクが優先される', async () => {
    const historyEntries: Record<string, string> = {};
    for (const t of TASKS.desk) historyEntries[t.id] = daysAgoString(1);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));

    // 全5件をskipRate 0（スキップ0件）に揃えたうえで、表示回数だけを変える
    const stats: TaskStats = {
      desk_001: { shownCount: 20, completedCount: 0, skippedCount: 0, lastShownAt: null },
      desk_002: { shownCount: 3, completedCount: 0, skippedCount: 0, lastShownAt: null }, // 表示回数が最少 → 優先
      desk_003: { shownCount: 15, completedCount: 0, skippedCount: 0, lastShownAt: null },
      desk_004: { shownCount: 25, completedCount: 0, skippedCount: 0, lastShownAt: null },
      desk_005: { shownCount: 10, completedCount: 0, skippedCount: 0, lastShownAt: null },
    };
    await saveTaskStats(stats);

    const chosen = await pickTaskForCategory('desk');

    expect(chosen.id).toBe('desk_002');
  });

  it('hiddenTaskIdsはフォールバック候補から引き続き除外される（ステップ5との整合性）', async () => {
    const historyEntries: Record<string, string> = {};
    for (const t of TASKS.desk) historyEntries[t.id] = daysAgoString(1);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));

    // desk_001が最終実施日で並べても最優先になりうるよう細工しても、非表示なら除外されるはず
    const stats: TaskStats = {
      desk_001: { shownCount: 0, completedCount: 0, skippedCount: 0, lastShownAt: null },
    };
    await saveTaskStats(stats);

    const chosen = await pickTaskForCategory('desk', undefined, 'unset', ['desk_001']);

    expect(chosen.id).not.toBe('desk_001');
  });

  it('選択されたタスクのshownCountが記録され、lastShownAtが更新される', async () => {
    const chosen = await pickTaskForCategory('desk');

    const stats = await loadTaskStats();
    expect(stats[chosen.id]?.shownCount).toBe(1);
    expect(stats[chosen.id]?.lastShownAt).toEqual(expect.any(String));
  });

  it('excludeTaskIdで示されたタスクのskippedCountが加算される', async () => {
    const target = TASKS.desk[0];

    await pickTaskForCategory('desk', target.id);

    const stats = await loadTaskStats();
    expect(stats[target.id]?.skippedCount).toBe(1);
  });
});

// ステップ5残タスク：「今後出さない」ボタン（タスク画面・長押しメニュー）が呼ぶ
// hideTaskAndPickReplacement のテスト（実装指示書2-6）。
describe('hideTaskAndPickReplacement（「今後出さない」選択後の一連の処理）', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('非表示にしたタスクは代替タスクとして返らず、以後の選択からも除外される', async () => {
    const target = TASKS.desk[0];
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const replacement = await hideTaskAndPickReplacement('desk', target.id);

    expect(replacement.id).not.toBe(target.id);
    // 除外後の先頭（desk_002）が選ばれているはず
    expect(replacement.id).toBe(TASKS.desk[1].id);

    // 非表示設定後、あらためて通常選択してもtargetは戻ってこない
    const prefs = await loadRobotVacuumPreferences();
    const again = await pickTaskForCategory('desk', undefined, 'unset', prefs.hiddenTaskIds);
    expect(again.id).not.toBe(target.id);
  });

  it('非表示設定はAsyncStorageに永続化される（hiddenTaskIdsに追加される）', async () => {
    const target = TASKS.desk[0];

    await hideTaskAndPickReplacement('desk', target.id);

    const prefs = await loadRobotVacuumPreferences();
    expect(prefs.hiddenTaskIds).toContain(target.id);
  });

  it('カテゴリ内の残り全タスクも非表示にすると、最後の1件を隠した呼び出しでNoEligibleTaskErrorが投げられる', async () => {
    const ids = TASKS.desk.map((t) => t.id);

    // 最初の4件は毎回代替タスクが存在するので正常に完了する
    for (let i = 0; i < ids.length - 1; i++) {
      await hideTaskAndPickReplacement('desk', ids[i]);
    }

    // 5件目（最後の1件）を隠すと、代替タスクが無いためエラーになる
    await expect(hideTaskAndPickReplacement('desk', ids[ids.length - 1])).rejects.toThrow(
      NoEligibleTaskError
    );

    // エラーになっても「非表示にする」設定自体は保存されている（自動解除しない）
    const prefs = await loadRobotVacuumPreferences();
    expect(prefs.hiddenTaskIds.sort()).toEqual([...ids].sort());
  });
});

// ステップ6残タスク：Case B（非表示による候補枯渇）の案内文言（実装指示書2-7・9-3 B）。
// App.js自体はJestで直接テストできないため、Alert.alertが参照する文言を
// エクスポート定数として切り出し、指示書記載の文言と一致することを固定する。
describe('NoEligibleTaskError案内文言（実装指示書9-3 B）', () => {
  it('メッセージは指示書記載の「今出せるタスクが少なくなっています。」と一致する', () => {
    expect(NO_ELIGIBLE_TASK_MESSAGE).toBe('今出せるタスクが少なくなっています。');
  });

  it('選択肢は指示書記載の「他の場所を見る」「出さない設定を見直す」と一致する', () => {
    expect(NO_ELIGIBLE_TASK_OPTION_OTHER_PLACE).toBe('他の場所を見る');
    expect(NO_ELIGIBLE_TASK_OPTION_REVIEW_HIDDEN).toBe('出さない設定を見直す');
  });
});

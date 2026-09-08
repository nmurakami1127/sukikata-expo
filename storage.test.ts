// updateRobotVacuumStatus（設定画面からのロボット掃除機利用状況の明示的な変更）のテスト。
// バナーの再表示制御用状態（robotPromptDismissedAt / floorCategoryUseCountSinceLastPrompt）や
// hiddenTaskIdsには一切触れない、という要件を固定するためのテスト。

import {
  updateRobotVacuumStatus,
  hideTask,
  unhideTask,
  shouldShowRobotPrompt,
  recordFloorCategoryUse,
  dismissRobotPrompt,
  FLOOR_PROMPT_THRESHOLD,
} from './storage';
import { RobotVacuumPreferences } from './types';

describe('updateRobotVacuumStatus（設定画面からのロボット掃除機利用状況の変更）', () => {
  const basePrefs: RobotVacuumPreferences = {
    robotVacuumStatus: 'owner',
    robotVacuumStatusUpdatedAt: '2026-01-01T00:00:00.000Z',
    // バナー側の状態。設定画面からの変更では触れないことを確認する対象
    robotPromptDismissedAt: '2026-02-01T00:00:00.000Z',
    floorCategoryUseCountSinceLastPrompt: 2,
    hiddenTaskIds: ['floor_001'],
  };

  it('robotVacuumStatusとrobotVacuumStatusUpdatedAtのみを更新する', () => {
    const now = new Date('2026-09-08T10:00:00.000Z');

    const next = updateRobotVacuumStatus(basePrefs, 'considering', now);

    expect(next.robotVacuumStatus).toBe('considering');
    expect(next.robotVacuumStatusUpdatedAt).toBe(now.toISOString());
  });

  it('バナーの再表示制御用状態（robotPromptDismissedAt / floorCategoryUseCountSinceLastPrompt）には触れない', () => {
    const now = new Date('2026-09-08T10:00:00.000Z');

    const next = updateRobotVacuumStatus(basePrefs, 'considering', now);

    expect(next.robotPromptDismissedAt).toBe(basePrefs.robotPromptDismissedAt);
    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(
      basePrefs.floorCategoryUseCountSinceLastPrompt
    );
  });

  it('hiddenTaskIdsには触れない', () => {
    const next = updateRobotVacuumStatus(basePrefs, 'unset');

    expect(next.hiddenTaskIds).toEqual(basePrefs.hiddenTaskIds);
  });

  it('「未設定に戻す」（unsetへの変更）でもバナー側の状態は維持される', () => {
    const now = new Date('2026-09-08T10:00:00.000Z');

    const next = updateRobotVacuumStatus(basePrefs, 'unset', now);

    expect(next.robotVacuumStatus).toBe('unset');
    expect(next.robotVacuumStatusUpdatedAt).toBe(now.toISOString());
    expect(next.robotPromptDismissedAt).toBe(basePrefs.robotPromptDismissedAt);
    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(
      basePrefs.floorCategoryUseCountSinceLastPrompt
    );
    expect(next.hiddenTaskIds).toEqual(basePrefs.hiddenTaskIds);
  });

  it('nowを省略した場合は呼び出し時点の日時が使われる', () => {
    const before = Date.now();
    const next = updateRobotVacuumStatus(basePrefs, 'owner');
    const after = Date.now();

    const updatedAtMs = new Date(next.robotVacuumStatusUpdatedAt as string).getTime();
    expect(updatedAtMs).toBeGreaterThanOrEqual(before);
    expect(updatedAtMs).toBeLessThanOrEqual(after);
  });
});

// hideTask/unhideTask（「今後出さない」の追加・解除、実装指示書2-6）のテスト。
describe('hideTask / unhideTask（「今後出さない」の追加・解除）', () => {
  const basePrefs: RobotVacuumPreferences = {
    robotVacuumStatus: 'owner',
    robotVacuumStatusUpdatedAt: '2026-01-01T00:00:00.000Z',
    robotPromptDismissedAt: null,
    floorCategoryUseCountSinceLastPrompt: 0,
    hiddenTaskIds: ['floor_001'],
  };

  it('hideTaskは指定タスクIDをhiddenTaskIdsに追加する', () => {
    const next = hideTask(basePrefs, 'floor_002');

    expect(next.hiddenTaskIds).toEqual(['floor_001', 'floor_002']);
  });

  it('hideTaskは既に非表示のタスクIDを重複追加しない', () => {
    const next = hideTask(basePrefs, 'floor_001');

    expect(next.hiddenTaskIds).toEqual(['floor_001']);
  });

  it('hideTaskはhiddenTaskIds以外のフィールドに触れない', () => {
    const next = hideTask(basePrefs, 'floor_002');

    expect(next.robotVacuumStatus).toBe(basePrefs.robotVacuumStatus);
    expect(next.robotVacuumStatusUpdatedAt).toBe(basePrefs.robotVacuumStatusUpdatedAt);
    expect(next.robotPromptDismissedAt).toBe(basePrefs.robotPromptDismissedAt);
    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(
      basePrefs.floorCategoryUseCountSinceLastPrompt
    );
  });

  it('unhideTaskは指定タスクIDをhiddenTaskIdsから取り除く', () => {
    const next = unhideTask(basePrefs, 'floor_001');

    expect(next.hiddenTaskIds).toEqual([]);
  });

  it('unhideTaskは存在しないタスクIDを指定してもエラーにならず、他のIDに影響しない', () => {
    const next = unhideTask(basePrefs, 'not_hidden_task');

    expect(next.hiddenTaskIds).toEqual(basePrefs.hiddenTaskIds);
  });

  it('unhideTaskはhiddenTaskIds以外のフィールドに触れない', () => {
    const next = unhideTask(basePrefs, 'floor_001');

    expect(next.robotVacuumStatus).toBe(basePrefs.robotVacuumStatus);
    expect(next.robotVacuumStatusUpdatedAt).toBe(basePrefs.robotVacuumStatusUpdatedAt);
    expect(next.robotPromptDismissedAt).toBe(basePrefs.robotPromptDismissedAt);
    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(
      basePrefs.floorCategoryUseCountSinceLastPrompt
    );
  });
});

// ステップ7：ホーム画面バナーの表示条件・再表示ロジック（実装指示書2-2・要求定義4-2）のテスト。
// UI（App.js側でのバナー表示）は今回対象外。ここでは判定ロジックのみを検証する。

function daysAgoIso(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

describe('dismissRobotPrompt（「今は設定しない」選択時の状態更新）', () => {
  const basePrefs: RobotVacuumPreferences = {
    robotVacuumStatus: 'unset',
    robotVacuumStatusUpdatedAt: null,
    robotPromptDismissedAt: null,
    floorCategoryUseCountSinceLastPrompt: 3,
    hiddenTaskIds: ['floor_001'],
  };

  it('robotPromptDismissedAtを現在日時に更新し、floorCategoryUseCountSinceLastPromptを0にリセットする', () => {
    const now = new Date('2026-09-09T10:00:00.000Z');

    const next = dismissRobotPrompt(basePrefs, now);

    expect(next.robotPromptDismissedAt).toBe(now.toISOString());
    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(0);
  });

  it('robotVacuumStatus/hiddenTaskIdsには触れない', () => {
    const next = dismissRobotPrompt(basePrefs);

    expect(next.robotVacuumStatus).toBe(basePrefs.robotVacuumStatus);
    expect(next.hiddenTaskIds).toEqual(basePrefs.hiddenTaskIds);
  });
});

describe('recordFloorCategoryUse（「床」カテゴリ選択時のカウンタ更新）', () => {
  it('用途A：dismissedAtがnullの間はunsetユーザーの選択のたびに+1する', () => {
    const prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'unset',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: null,
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };

    const next = recordFloorCategoryUse(prefs);

    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(1);
  });

  it('用途B：「今は設定しない」後31日未満はカウントアップしない', () => {
    const now = new Date('2026-09-09T10:00:00.000Z');
    const prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'unset',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: daysAgoIso(10, now),
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };

    const next = recordFloorCategoryUse(prefs, now);

    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(0);
  });

  it('用途B：「今は設定しない」後31日以上経過していればカウントアップする', () => {
    const now = new Date('2026-09-09T10:00:00.000Z');
    const prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'unset',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: daysAgoIso(31, now),
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };

    const next = recordFloorCategoryUse(prefs, now);

    expect(next.floorCategoryUseCountSinceLastPrompt).toBe(1);
  });

  it('owner/consideringに確定している場合はカウントアップしない（バナー自体参照しないため）', () => {
    const prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'owner',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: null,
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };

    const next = recordFloorCategoryUse(prefs);

    expect(next).toEqual(prefs);
  });
});

describe('shouldShowRobotPrompt（バナー表示条件の判定・実装指示書2-2受け入れ条件）', () => {
  const unsetPrefs: RobotVacuumPreferences = {
    robotVacuumStatus: 'unset',
    robotVacuumStatusUpdatedAt: null,
    robotPromptDismissedAt: null,
    floorCategoryUseCountSinceLastPrompt: 0,
    hiddenTaskIds: [],
  };

  it('同一セッション内で既に閉じている場合は表示しない', () => {
    const prefs = { ...unsetPrefs, floorCategoryUseCountSinceLastPrompt: FLOOR_PROMPT_THRESHOLD };
    expect(shouldShowRobotPrompt(prefs, true)).toBe(false);
  });

  it('robotVacuumStatusがunset以外（owner/considering）の場合は表示しない', () => {
    const prefs: RobotVacuumPreferences = {
      ...unsetPrefs,
      robotVacuumStatus: 'owner',
      floorCategoryUseCountSinceLastPrompt: FLOOR_PROMPT_THRESHOLD,
    };
    expect(shouldShowRobotPrompt(prefs, false)).toBe(false);
  });

  it('初回案内前：床カテゴリ利用回数が閾値未満なら表示しない', () => {
    const prefs = {
      ...unsetPrefs,
      floorCategoryUseCountSinceLastPrompt: FLOOR_PROMPT_THRESHOLD - 1,
    };
    expect(shouldShowRobotPrompt(prefs, false)).toBe(false);
  });

  it('初回案内前：床カテゴリ利用回数が閾値に達したら表示する', () => {
    const prefs = {
      ...unsetPrefs,
      floorCategoryUseCountSinceLastPrompt: FLOOR_PROMPT_THRESHOLD,
    };
    expect(shouldShowRobotPrompt(prefs, false)).toBe(true);
  });

  it('「今は設定しない」後30日目：床カテゴリを再利用していても表示しない（31日目未満）', () => {
    const now = new Date('2026-09-09T10:00:00.000Z');
    const prefs: RobotVacuumPreferences = {
      ...unsetPrefs,
      robotPromptDismissedAt: daysAgoIso(30, now),
      floorCategoryUseCountSinceLastPrompt: 1,
    };
    expect(shouldShowRobotPrompt(prefs, false, now)).toBe(false);
  });

  it('「今は設定しない」後31日目以降でも、床カテゴリの利用が無ければ表示しない', () => {
    const now = new Date('2026-09-09T10:00:00.000Z');
    const prefs: RobotVacuumPreferences = {
      ...unsetPrefs,
      robotPromptDismissedAt: daysAgoIso(45, now),
      floorCategoryUseCountSinceLastPrompt: 0,
    };
    expect(shouldShowRobotPrompt(prefs, false, now)).toBe(false);
  });

  it('「今は設定しない」後31日目以降に床カテゴリを利用していれば表示候補になる', () => {
    const now = new Date('2026-09-09T10:00:00.000Z');
    const prefs: RobotVacuumPreferences = {
      ...unsetPrefs,
      robotPromptDismissedAt: daysAgoIso(31, now),
      floorCategoryUseCountSinceLastPrompt: 1,
    };
    expect(shouldShowRobotPrompt(prefs, false, now)).toBe(true);
  });
});

describe('バナーロジックの結合シナリオ（recordFloorCategoryUse + shouldShowRobotPrompt）', () => {
  it('初回：床カテゴリをFLOOR_PROMPT_THRESHOLD回選ぶとバナー表示対象になる', () => {
    let prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'unset',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: null,
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };

    for (let i = 0; i < FLOOR_PROMPT_THRESHOLD; i++) {
      prefs = recordFloorCategoryUse(prefs);
    }

    expect(shouldShowRobotPrompt(prefs, false)).toBe(true);
  });

  it('「今は設定しない」後、床カテゴリを使わなければ31日目以降も表示されない', () => {
    const dismissedAt = new Date('2026-08-01T00:00:00.000Z');
    let prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'unset',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: null,
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };
    prefs = dismissRobotPrompt(prefs, dismissedAt);

    const laterNow = new Date(dismissedAt);
    laterNow.setDate(laterNow.getDate() + 45); // 床カテゴリの利用なしで45日経過

    expect(shouldShowRobotPrompt(prefs, false, laterNow)).toBe(false);
  });

  it('「今は設定しない」後、31日目以降に床カテゴリを利用すると次回ホーム画面で表示候補になる', () => {
    const dismissedAt = new Date('2026-08-01T00:00:00.000Z');
    let prefs: RobotVacuumPreferences = {
      robotVacuumStatus: 'unset',
      robotVacuumStatusUpdatedAt: null,
      robotPromptDismissedAt: null,
      floorCategoryUseCountSinceLastPrompt: 0,
      hiddenTaskIds: [],
    };
    prefs = dismissRobotPrompt(prefs, dismissedAt);

    const useAt = new Date(dismissedAt);
    useAt.setDate(useAt.getDate() + 31); // 31日目に床カテゴリを利用
    prefs = recordFloorCategoryUse(prefs, useAt);

    expect(shouldShowRobotPrompt(prefs, false, useAt)).toBe(true);
  });
});

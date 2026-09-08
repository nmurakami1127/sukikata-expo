// updateRobotVacuumStatus（設定画面からのロボット掃除機利用状況の明示的な変更）のテスト。
// バナーの再表示制御用状態（robotPromptDismissedAt / floorCategoryUseCountSinceLastPrompt）や
// hiddenTaskIdsには一切触れない、という要件を固定するためのテスト。

import { updateRobotVacuumStatus, hideTask, unhideTask } from './storage';
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

// ロボット掃除機関連タスクの投入（実装指示書3章）に関するテスト。
// タスク内容そのものではなく、実装指示書の受け入れ条件・要件（ID一意性、
// audiences構成、件数目安、NG表現の不使用）を固定するためのテスト。

import { TASKS, Task, findTaskById } from './taskData';

const ALL_TASKS: Task[] = Object.values(TASKS).flat();

// 実装指示書3-3「NG表現（実装・レビュー時にチェック）」。
// タスクのtitle/noteに、断定的な「使える／対応済み」表現が紛れ込んでいないことを確認する。
const NG_PHRASES = [
  '使える状態になりました',
  '準備完了です',
  'この部屋なら問題なく使えます',
  '対応済みです',
];

describe('taskData（ロボット掃除機関連タスクの投入・実装指示書3章）', () => {
  it('全タスクのIDはカテゴリをまたいで重複しない', () => {
    const ids = ALL_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('robot_owner または robot_considering を含むタスクが20件以上ある（9-1の目安）', () => {
    const robotRelated = ALL_TASKS.filter(
      (t) =>
        t.audiences?.includes('robot_owner') ||
        t.audiences?.includes('robot_considering')
    );
    expect(robotRelated.length).toBeGreaterThanOrEqual(20);
  });

  it('所有者・購入検討者の共通タスク（audiencesにrobot_owner/robot_considering両方）が15件ある', () => {
    const common = ALL_TASKS.filter(
      (t) =>
        t.audiences?.includes('robot_owner') &&
        t.audiences?.includes('robot_considering')
    );
    expect(common.length).toBe(15);
  });

  it('購入検討者向け確認タスク（robot_consideringのみでrobot_ownerを含まない）が6件ある', () => {
    const considerOnly = ALL_TASKS.filter(
      (t) =>
        t.audiences?.includes('robot_considering') &&
        !t.audiences?.includes('robot_owner')
    );
    expect(considerOnly.length).toBe(6);
  });

  it('全タスクのtitle/noteに断定的なNG表現が含まれない（3-3）', () => {
    for (const t of ALL_TASKS) {
      for (const phrase of NG_PHRASES) {
        expect(t.title).not.toContain(phrase);
        expect(t.note).not.toContain(phrase);
      }
    }
  });
});

describe('findTaskById（「出さない設定にしたタスク」一覧でのタイトル解決に使用）', () => {
  it('カテゴリをまたいで、IDからタスクを見つけられる', () => {
    expect(findTaskById('floor_robot_016')).toEqual(
      TASKS.floor.find((t) => t.id === 'floor_robot_016')
    );
    expect(findTaskById('desk_001')).toEqual(TASKS.desk[0]);
  });

  it('存在しないIDにはundefinedを返す', () => {
    expect(findTaskById('not_a_real_task_id')).toBeUndefined();
  });
});

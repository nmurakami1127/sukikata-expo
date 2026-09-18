// ロボット掃除機関連タスクの投入・仕分け（実装指示書1章、A/B/C区分）に関するテスト。
// タスク内容そのものではなく、仕分け結果がデータ構造に正しく反映されていることを固定する。

import { TASKS, ROBOT_CHECK_TASKS, Task, findTaskById } from './taskData';

const ALL_MAIN_TASKS: Task[] = Object.values(TASKS).flat();
// タスクプール全体（通常選択ロジックの対象=TASKS）＋独立フロー用（ROBOT_CHECK_TASKS）。
// ID一意性・NG表現チェックなど、選択ロジックの対象かどうかによらず全タスクに課したい
// 制約はこちらを使う。
const ALL_TASKS_INCLUDING_CHECK: Task[] = [...ALL_MAIN_TASKS, ...ROBOT_CHECK_TASKS];

// A区分（実装指示書1-2）：日常的な片付けとして単体で意味があるため通常タスク化した5件。
// audiencesを持たない＝所有者向けの重み調整（taskPicker.ts）の対象にならない。
const A_CLASS_IDS = [
  'floor_robot_001',
  'floor_robot_003',
  'floor_robot_004',
  'floor_robot_007',
  'floor_robot_013',
];

// B区分（実装指示書1-3）：ロボット掃除機を使う直前の一括片付け行動とは合わない細分化タスク10件。
// audiencesはrobot_owner/robot_consideringを維持し、taskPicker.ts側で所有者のみ重みを下げる。
const B_CLASS_IDS = [
  'floor_robot_002',
  'floor_robot_005',
  'floor_robot_006',
  'floor_robot_008',
  'floor_robot_009',
  'floor_robot_010',
  'floor_robot_011',
  'floor_robot_012',
  'floor_robot_014',
  'floor_robot_015',
];

// C区分（実装指示書1-4）：購入検討者向け「迎える前チェック」独立フローへ移設した6件。
const C_CLASS_IDS = [
  'floor_robot_016',
  'floor_robot_017',
  'floor_robot_018',
  'floor_robot_019',
  'floor_robot_020',
  'floor_robot_021',
];

// 実装指示書3-3「NG表現（実装・レビュー時にチェック）」。
// タスクのtitle/noteに、断定的な「使える／対応済み」表現が紛れ込んでいないことを確認する。
const NG_PHRASES = [
  '使える状態になりました',
  '準備完了です',
  'この部屋なら問題なく使えます',
  '対応済みです',
];

describe('taskData（ロボット掃除機関連タスクのA/B/C仕分け・実装指示書1章）', () => {
  it('全タスクのIDは、通常プール（TASKS）とROBOT_CHECK_TASKSを合わせても重複しない', () => {
    const ids = ALL_TASKS_INCLUDING_CHECK.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('A区分5件は「床」カテゴリに存在し、audiencesを持たない（通常タスク化・優先表示対象外）', () => {
    for (const id of A_CLASS_IDS) {
      const task = TASKS.floor.find((t) => t.id === id);
      expect(task).toBeDefined();
      expect(task?.audiences).toBeUndefined();
    }
  });

  it('A区分5件も、分析用のtagsは維持している（「意味情報」と「提示ロジック」の分離）', () => {
    for (const id of A_CLASS_IDS) {
      const task = TASKS.floor.find((t) => t.id === id);
      expect(task?.tags).toEqual(expect.arrayContaining(['robot_vacuum']));
    }
  });

  it('B区分10件は「床」カテゴリに存在し、audiencesにrobot_owner/robot_considering両方を維持している', () => {
    for (const id of B_CLASS_IDS) {
      const task = TASKS.floor.find((t) => t.id === id);
      expect(task).toBeDefined();
      expect(task?.audiences).toEqual(
        expect.arrayContaining(['robot_owner', 'robot_considering'])
      );
    }
  });

  it('C区分6件は「床」カテゴリ（TASKS.floor）には存在しない（独立フローへ移設済み）', () => {
    for (const id of C_CLASS_IDS) {
      expect(TASKS.floor.find((t) => t.id === id)).toBeUndefined();
    }
  });

  it('C区分6件はROBOT_CHECK_TASKSに存在し、audiencesはrobot_consideringのみを持つ', () => {
    expect(ROBOT_CHECK_TASKS.length).toBe(6);
    for (const id of C_CLASS_IDS) {
      const task = ROBOT_CHECK_TASKS.find((t) => t.id === id);
      expect(task).toBeDefined();
      expect(task?.audiences).toEqual(['robot_considering']);
    }
  });

  it('「床」カテゴリのaudiences保有タスク（=taskPicker.tsの重み調整対象）はB区分の10件のみになっている', () => {
    const audienceTagged = TASKS.floor.filter((t) => t.audiences && t.audiences.length > 0);
    expect(audienceTagged.map((t) => t.id).sort()).toEqual([...B_CLASS_IDS].sort());
  });

  it('全タスクのtitle/noteに断定的なNG表現が含まれない（3-3、ROBOT_CHECK_TASKSも対象）', () => {
    for (const t of ALL_TASKS_INCLUDING_CHECK) {
      for (const phrase of NG_PHRASES) {
        expect(t.title).not.toContain(phrase);
        expect(t.note).not.toContain(phrase);
      }
    }
  });
});

describe('findTaskById（「出さない設定にしたタスク」一覧でのタイトル解決に使用）', () => {
  it('カテゴリをまたいで、TASKS内のIDからタスクを見つけられる', () => {
    expect(findTaskById('floor_robot_002')).toEqual(
      TASKS.floor.find((t) => t.id === 'floor_robot_002')
    );
    expect(findTaskById('desk_001')).toEqual(TASKS.desk[0]);
  });

  it('TASKSには含まれないROBOT_CHECK_TASKSのIDも解決できる（C区分移設に伴う回帰対策）', () => {
    expect(findTaskById('floor_robot_016')).toEqual(
      ROBOT_CHECK_TASKS.find((t) => t.id === 'floor_robot_016')
    );
  });

  it('存在しないIDにはundefinedを返す', () => {
    expect(findTaskById('not_a_real_task_id')).toBeUndefined();
  });
});

// スキかた - 場所別タスクバンク

export interface Task {
  id: string;
  title: string;
  note: string;
  cooldownDays: number;
  // ここから任意フィールド（次期リリース：ロボット掃除機パーソナライズ用）。
  // 省略された既存タスクはそのまま動作する（後方互換）。
  /** 分析用途のみ。タスク選択のフィルタリングには使わない */
  tags?: string[];
  /** 優先して提示する対象。省略時は ["all"] 扱い */
  audiences?: string[];
  /** 表示優先度の重み。省略時は 1 */
  weight?: number;
}

export interface Category {
  id: string;
  label: string;
}

export const CATEGORIES: Category[] = [
  { id: 'desk', label: '机' },
  { id: 'floor', label: '床' },
  { id: 'shelf', label: '棚・収納' },
  { id: 'kitchen', label: 'キッチン' },
  { id: 'living', label: 'リビング' },
  { id: 'entrance', label: '玄関' },
  { id: 'closet', label: 'クローゼット' },
  { id: 'digital', label: 'デジタル' },
];

/** カテゴリごとの淡い背景色とアイコン用のアクセント色 */
export const CATEGORY_STYLE: Record<string, { bg: string; accent: string }> = {
  desk: { bg: '#E7EFE3', accent: '#7E9578' },
  floor: { bg: '#F1E9D8', accent: '#B4914E' },
  shelf: { bg: '#F3E1DA', accent: '#C97F68' },
  kitchen: { bg: '#E3ECE6', accent: '#5F8C74' },
  living: { bg: '#F5E7CD', accent: '#BE9346' },
  entrance: { bg: '#EDE1E8', accent: '#A8728F' },
  closet: { bg: '#E4E6EF', accent: '#7480A8' },
  digital: { bg: '#E6E9E3', accent: '#6E7A63' },
};

export const TASKS: Record<string, Task[]> = {
  desk: [
    { id: 'desk_001', title: '机の上のゴミだけを捨てる', note: '分別は考えず、明らかなゴミのみ', cooldownDays: 14 },
    { id: 'desk_002', title: '机の上の紙類を1箇所に重ねる', note: '仕分けはしない、集めるだけ', cooldownDays: 14 },
    { id: 'desk_003', title: '使ったペン・文房具を1つの場所に戻す', note: '定位置がなければ「ペン置き場」を作るだけでOK', cooldownDays: 14 },
    { id: 'desk_004', title: 'マグカップ・食器を1つシンクへ運ぶ', note: '複数ある場合は1つだけでも可', cooldownDays: 14 },
    { id: 'desk_005', title: '机の上を写真に撮って「今日はここまで」宣言', note: 'かたづけしなくても記録だけでもOKという選択肢', cooldownDays: 14 },
  ],
  floor: [
    { id: 'floor_001', title: '床に落ちている服を1着だけハンガーへ', note: '全部ではなく1着', cooldownDays: 14 },
    { id: 'floor_002', title: '見える範囲のゴミ・紙くずを拾う', note: '3分タイマー推奨', cooldownDays: 14 },
    { id: 'floor_003', title: '床にあるものを3つだけ、本来の場所に戻す', note: '数を区切ることで完了しやすくする', cooldownDays: 14 },
    { id: 'floor_004', title: '床の一角（1畳分）だけ何もない状態にする', note: '全体ではなく範囲を限定', cooldownDays: 14 },
    // ここから：ロボット掃除機所有者・購入検討者の共通タスク（実装指示書3-1、15件）。
    // 通常の「床」カテゴリ内で共用し、専用に複製したタスクリストは持たない。
    {
      id: 'floor_robot_001',
      title: '床にある服を1着だけ戻す',
      note: '全部ではなく1着だけでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'clothes', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_002',
      title: '床にあるものを3つだけ元の場所へ戻す',
      note: '数を区切ることで完了しやすくする',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_003',
      title: '床のコードを1か所だけ上げる',
      note: 'つまずき防止に。1か所だけでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'cables'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_004',
      title: 'バッグを1つだけ床から移動する',
      note: '複数あっても1つだけでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_005',
      title: '小物を3つだけ拾う',
      note: '3つ拾ったら終わりでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_006',
      title: '椅子の周りを1か所だけ空ける',
      note: '椅子1脚分だけに限定',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_007',
      title: '通り道を1本だけ空ける',
      note: 'よく通る道を1本だけ',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_008',
      title: '床に垂れている布を1か所だけ上げる',
      note: 'カーテンやタオルなど、1か所だけ',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_009',
      title: 'ペットのおもちゃを3つだけまとめる',
      note: '3つまとめたら終わりでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'pet'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_010',
      title: '床の一角だけ何もない状態にする',
      note: '全体ではなく一角に限定',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_011',
      title: '床にある紙類を3枚だけまとめる',
      note: '仕分けはせず、集めるだけ',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'paper'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_012',
      title: 'スリッパを1組だけ端へ寄せる',
      note: '1組だけでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_013',
      title: '延長コード周辺のものを3つだけ移動する',
      note: 'コードの上にあるものを3つだけ',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'cables'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_014',
      title: 'ベッド脇の床を少し空ける',
      note: '少しだけでOK、全体を片付けなくていい',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    {
      id: 'floor_robot_015',
      title: 'ソファ前の小物を3つだけ移動する',
      note: '3つ移動したら終わりでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum', 'low_decision'],
      audiences: ['robot_owner', 'robot_considering'],
    },
    // ここから：購入検討者向け確認タスク（実装指示書3-2、6件）。
    // 「使える／使えない」を判定するタスクではなく、生活環境に気づくための確認タスク。
    // audiencesはrobot_consideringのみ（所有者には出さない）。
    {
      id: 'floor_robot_016',
      title: 'ロボット掃除機が通りそうな場所のコードを1か所確認する',
      note: '確認するだけでOK、片付けなくてもよい',
      cooldownDays: 14,
      tags: ['robot_vacuum'],
      audiences: ['robot_considering'],
    },
    {
      id: 'floor_robot_017',
      title: '床によく置いているものを1つだけ確認する',
      note: '気になるものを1つ見てみるだけ',
      cooldownDays: 14,
      tags: ['robot_vacuum'],
      audiences: ['robot_considering'],
    },
    {
      id: 'floor_robot_018',
      title: '段差やマットのある場所を1か所確認する',
      note: '1か所だけ確認すればOK',
      cooldownDays: 14,
      tags: ['robot_vacuum'],
      audiences: ['robot_considering'],
    },
    {
      id: 'floor_robot_019',
      title: 'ロボット掃除機を置けそうな場所を1か所確認する',
      note: '置き場所を1か所考えてみるだけ',
      cooldownDays: 14,
      tags: ['robot_vacuum'],
      audiences: ['robot_considering'],
    },
    {
      id: 'floor_robot_020',
      title: '床まで垂れているカーテンや布を1か所確認する',
      note: '1か所だけ見てみるだけでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum'],
      audiences: ['robot_considering'],
    },
    {
      id: 'floor_robot_021',
      title: 'よく物が集まる床の一角を1か所確認する',
      note: '1か所だけ確認するだけでOK',
      cooldownDays: 14,
      tags: ['robot_vacuum'],
      audiences: ['robot_considering'],
    },
  ],
  shelf: [
    { id: 'shelf_001', title: '棚の一段だけ、中身を出して埃を拭く', note: '一段だけに限定するのが鍵', cooldownDays: 14 },
    { id: 'shelf_002', title: '賞味期限切れ・使わないものを3つ探して捨てる', note: '「探すゲーム」化してハードルを下げる', cooldownDays: 14 },
    { id: 'shelf_003', title: 'ぐちゃぐちゃな引き出しを1つだけ開けて整える', note: '引き出し1個だけ', cooldownDays: 14 },
    { id: 'shelf_004', title: '同じジャンルのものを1箇所に集める', note: '例：文房具、充電ケーブルなど', cooldownDays: 14 },
  ],
  kitchen: [
    { id: 'kitchen_001', title: 'シンクの中の食器を3つだけ洗う', note: '全部洗わなくていい', cooldownDays: 14 },
    { id: 'kitchen_002', title: 'コンロ周りを布で1拭きする', note: 'ながら作業でも可', cooldownDays: 14 },
    { id: 'kitchen_003', title: '冷蔵庫の中の期限切れを1つ捨てる', note: '探すのは1つだけでOK', cooldownDays: 14 },
    { id: 'kitchen_004', title: '水切りカゴの乾いた食器をしまう', note: '5分以内で完結', cooldownDays: 14 },
  ],
  living: [
    { id: 'living_001', title: 'ソファの上のものを3つだけ元の場所に戻す', note: '数を限定', cooldownDays: 14 },
    { id: 'living_002', title: 'テーブルの上の郵便物・レシートをまとめる', note: '仕分けせず1箇所に集めるだけ', cooldownDays: 14 },
    { id: 'living_003', title: 'リモコン・充電器の定位置を1つ決めて置く', note: '「住所」作りの第一歩', cooldownDays: 14 },
    { id: 'living_004', title: 'クッション・ブランケットを整える', note: 'ビジュアル的な変化が出やすい', cooldownDays: 14 },
  ],
  entrance: [
    { id: 'entrance_001', title: '靴を2足だけ靴箱にしまう', note: '全部でなく2足から', cooldownDays: 14 },
    { id: 'entrance_002', title: '玄関マットの砂・ゴミを払う', note: 'サッとでOK', cooldownDays: 14 },
    { id: 'entrance_003', title: '郵便物・チラシを1箇所にまとめる', note: '仕分け不要', cooldownDays: 14 },
    { id: 'entrance_004', title: '傘立ての傘を整える', note: '壊れた傘があれば1本だけ処分', cooldownDays: 14 },
  ],
  closet: [
    { id: 'closet_001', title: 'ハンガーにかかっていない服を1着だけかける', note: '1着だけでOK', cooldownDays: 14 },
    { id: 'closet_002', title: '「1年着ていない服」を1着だけ選び出す', note: '捨てる判断はさせない、選ぶだけ', cooldownDays: 14 },
    { id: 'closet_003', title: '洗濯物のたたみを3枚だけ行う', note: '全部でなく3枚', cooldownDays: 14 },
    { id: 'closet_004', title: '靴下・下着の引き出しを1段だけ整える', note: '範囲限定', cooldownDays: 14 },
  ],
  digital: [
    { id: 'digital_001', title: 'スマホの写真を10枚だけ見て不要なものを消す', note: '物理じゃなくてもOKという選択肢の提供', cooldownDays: 14 },
    { id: 'digital_002', title: 'カバンの中身を全部出し、必要なものだけ戻す', note: 'カバン1個に限定', cooldownDays: 14 },
    { id: 'digital_003', title: 'デスクトップのアイコンを3つだけ整理', note: 'デジタル散らかりにも対応', cooldownDays: 14 },
  ],
};

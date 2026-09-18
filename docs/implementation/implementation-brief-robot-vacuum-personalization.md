# 実装指示書：タスクパーソナライズ／ロボット掃除機対応（改訂版）

対象リポジトリ：スキマかたづけ（スキかた）MVP（React Native、iOS/Android共通コード：`App.js` / `taskPicker.ts` / `taskData.ts` / `storage.ts` / `analytics.ts`）
参照元：`docs/requirements/robot-vacuum-personalization.md`（改訂版要求定義書・正本）

> **改訂履歴**
> - v1（初版）：`docs/requirements/archive/robot-vacuum-personalization-v1.md` 相当の要求を実装指示に変換したもの。Step1〜9はv1のスコープでほぼ実装済み。
> - v2（2026-09-15）：企画側の実利用検証を踏まえた改訂版要求＋確認事項3点の回答を反映。ショートカット非表示化の方針・タスク仕分けドラフトを追記。
> - v3（本書、2026-09-16）：タスク仕分け(A/B/C)・B区分の重み調整ルール・C区分の記録分離方針について企画から回答があり、`taskData.ts`/`taskPicker.ts`へ反映**済み**。本書はその実装内容の記録であり、以後の変更点はない前提で書いている。

この指示書は上記の企画ドキュメントを実装タスクに変換したものです。仕様の解釈に迷った場合は、企画意図（判断負荷を増やさない／選択肢を増やさない／AIを使わない）を優先し、不明点は実装せず要確認としてリストアップしてください。

---

## 0. 変更してはいけない既存挙動（regression NG）

- 「場所を選ぶ → タスクを1つ表示」の基本導線
- 5分タイマー、Before/After写真、ストリーク（お休みチケット制）、通知のロジック
- タスク完了/スキップの計測イベント
- オンボーディング5画面（新規質問を追加しない）
- AI・アカウント登録・広告SDK・外部トラッキングSDK・位置情報取得を一切導入しない
- **ホーム画面バナー（4-3）の表示条件・再表示ロジック**：改訂版でも変更なしのため、既存実装（`storage.ts`の`shouldShowRobotPrompt`/`dismissRobotPrompt`、`App.js`の`showRobotPrompt`まわり）に手を入れない
- **`unset`ユーザーの床タスク出力分布**：`taskPicker.ts`の重み付けロジックが今回全面的に書き換わったが、`unset`は引き続き`pickRandom`による一様ランダム選択（audiences/weight一切参照なし）のまま

これらに触れる変更が必要になった場合は実装を止めて確認してください。

---

## 0-1. 現在の実装状況（2026-09-16時点）

| Step | 内容 | 実装箇所 | 状態 |
|---|---|---|---|
| 1 | データモデル拡張 | `taskData.ts`（`Task`型に`tags`/`audiences`/`weight`）、`storage.ts`（`robotVacuumStatus`等） | 維持 |
| 2 | タスク選択ロジック拡張 | `taskPicker.ts`（`effectiveWeight`/`selectWeightedTask`） | **v3で再設計・実装済み（2章）** |
| 3 | 利用状況設定画面 | 設定画面コンポーネント | 維持 |
| 4 | タスクコンテンツ投入・仕分け | `taskData.ts`の`TASKS.floor`（A/B区分15件）、`ROBOT_CHECK_TASKS`（C区分6件） | **v3でA/B/C仕分けを反映済み（1章）** |
| 5 | 「今後出さない」＋非表示管理 | `hiddenTaskIds`関連、`findTaskById` | 維持（`findTaskById`はC区分移設に伴い軽微な修正あり、1章参照） |
| 6 | フォールバック（A/B） | `taskPicker.ts`のフォールバック選出ロジック、`showNoEligibleTaskAlert`等 | 維持・変更なし |
| 7 | ホーム画面バナー | `storage.ts`の`shouldShowRobotPrompt`/`dismissRobotPrompt`、`App.js`の`showRobotPrompt`まわり | 維持・変更なし |
| 8 | ショートカット「ロボット掃除機前の5分」 | `App.js:815`の`showRobotShortcut` | **非表示化・実装済み（4章）** |
| 9 | 計測イベント（10種） | `analytics.ts` | 変更不要（5章） |
| — | 購入検討者向け「迎える前チェック」独立フロー | `taskData.ts`の`ROBOT_CHECK_TASKS`（データ基盤のみ） | **画面・状態遷移・記録先は未実装（3章）** |

---

## 1. タスクデータの仕分け反映（実装済み）

### 1-1. 判断基準

A/B/C区分そのものは`docs/requirements/robot-vacuum-task-classification-review.md`のとおり承認された。**今後この種の仕分けを行う際の判断基準は「個数指定の有無」ではなく「ロボット掃除機を使わない通常の片付け場面でも、そのタスク単体に意味があるか」を用いること。** 「〇〇を3つだけ」という体裁自体はMVP全体の設計原則（判断負荷を減らすための数量限定）であり、B区分か否かの判定軸にはならない。

### 1-2. A区分（5件）：`taskData.ts`

対象：`floor_robot_001`（服を1着戻す）、`floor_robot_003`（コードを1か所上げる）、`floor_robot_004`（バッグを1つ移動）、`floor_robot_007`（通り道を1本空ける）、`floor_robot_013`（延長コード周辺を3つ移動）。

**方針（「意味情報」と「提示ロジック」の分離）**：

- `tags`（`robot_vacuum`等）は残す。分析・コンテンツ分類目的として保持し、選択ロジックのフィルタリングには使わない（元々`tags`はそういう位置づけ）
- `audiences`フィールド自体を削除した（省略時は`"all"`扱いになり、既存の一般床タスクと完全に同列になる）
- これにより、`taskPicker.ts`側は何もしなくても「A区分は所有者向けの重み調整対象にならない」が保証される（`effectiveWeight`は`task.audiences?.includes('robot_owner')`で判定するため、`audiences`が無いタスクは常に通常の`weight`のみが適用される）

### 1-3. B区分（10件）：`taskData.ts`

対象：`floor_robot_002, 005, 006, 008, 009, 010, 011, 012, 014, 015`。

データ構造は変更していない（`audiences: ['robot_owner', 'robot_considering']`のまま）。重み調整は`taskPicker.ts`側のロジックのみで行う（2章）。

### 1-4. C区分（6件）：`taskData.ts`

対象：`floor_robot_016`〜`021`。

`TASKS.floor`配列から削除し、新規に`export const ROBOT_CHECK_TASKS: Task[]`として`taskData.ts`末尾に独立させた。これにより：

- 通常の「床」カテゴリの`pickTaskForCategory`からは一切参照されなくなる（cooldown・非表示除外・重み付け・`taskStats`のいずれの対象にもならない）
- 「迎える前チェック」独立フロー（3章）実装時に、この配列を直接参照する想定
- 副作用として`findTaskById`（`taskData.ts`、「出さない設定にしたタスク」一覧のタイトル解決用）が`TASKS`だけでなく`ROBOT_CHECK_TASKS`も検索するよう修正した。これは、C区分をまだ通常の床タスクプールに含んでいた期間に`floor_robot_016`〜`021`のいずれかを「今後出さない」設定していたユーザーがいた場合でも、非表示タスク一覧の表示が壊れない（タイトル未解決にならない）ようにするための回帰対策

---

## 2. タスク選択ロジックの再設計（実装済み）

### 2-1. 方針転換

改訂版要求定義書10章「ロボット掃除機利用者と相性の悪いタスクの重みを下げることを基本とする」を受け、`taskPicker.ts`の重み付けロジックを全面的に書き換えた。

| ユーザー状態 | B区分タスクの扱い | 実装 |
|---|---|---|
| `owner`（所有者） | 優先度を下げる | `effectiveWeight`が`ROBOT_OWNER_DEMOTION_MULTIPLIER`（0.5）を乗算 |
| `considering`（購入検討者） | 通常の重み（調整しない） | `task.weight ?? 1`をそのまま使用。持ち上げも下げも行わない |
| `unset`（未設定） | 通常の重み（調整しない） | 引き続き`pickRandom`による一様ランダム選択（既存回帰要件） |

旧実装（`ROBOT_AUDIENCE_WEIGHT_MULTIPLIER = 3`で`owner`/`considering`双方の該当タスクを持ち上げる方式）は完全に廃止した。`audienceForStatus`ヘルパーも不要になったため削除した。

### 2-2. 新定数`ROBOT_OWNER_DEMOTION_MULTIPLIER`

```ts
// taskPicker.ts
export const ROBOT_OWNER_DEMOTION_MULTIPLIER = 0.5;
```

- **意図**：完全に非表示にするのではなく、「他に通常タスクの候補がある場合は出にくくなるが、候補不足時（他の候補がクールダウン中等）には表示され得る」挙動にするため、0（完全除外）ではなく1未満の係数を使う
- **調整方法**：この値だけを変更すれば効果の強弱を調整できる（`effectiveWeight`本体のロジックには手を入れない）。0に近づけるほど「出にくさ」が強まり、1に近づけるほど効果が弱まる。0.5は暫定値であり、`robot_task_skipped`/`robot_task_completed`等の計測データを見ながら調整する想定
- **独立性**：旧`ROBOT_AUDIENCE_WEIGHT_MULTIPLIER`の逆数（1/3）等を流用せず、別の意図（持ち上げではなく下げる）を持つ値として独立した定数にしている

### 2-3. `effectiveWeight`/`selectWeightedTask`の実装

```ts
function effectiveWeight(task: Task, robotVacuumStatus: RobotVacuumStatus): number {
  const base = task.weight ?? 1;
  if (robotVacuumStatus === 'owner' && task.audiences?.includes('robot_owner')) {
    return base * ROBOT_OWNER_DEMOTION_MULTIPLIER;
  }
  return base;
}

export function selectWeightedTask(pool: Task[], robotVacuumStatus: RobotVacuumStatus): Task {
  if (robotVacuumStatus === 'unset') return pickRandom(pool);
  // owner/consideringともこの重み付き選択を通るが、effectiveWeightがconsideringには
  // 何も乗算しないため、considering は task.weight のみの通常抽選と等価になる
  ...
}
```

`audiences`が既にA区分では削除済み・C区分では`TASKS.floor`から除去済みのため、この時点で「床」カテゴリ内で`audiences?.includes('robot_owner')`に一致するのはB区分の10件のみに限定される。**新しい判定用フィールドを追加する必要はなかった**（A/Cの整理そのものがB区分の識別を兼ねる）。

### 2-4. 受け入れ条件

- [ ] `owner`ユーザーに対して、B区分タスクの表示頻度が`unset`/`considering`ユーザーより明確に低いこと（4章のテストで検証）
- [ ] `considering`ユーザーに対して、B区分タスクの表示頻度が`unset`と同等であること（重み調整が一切効いていないこと）
- [ ] A区分タスクは、`owner`ユーザーに対しても他の通常タスクと同等の頻度で表示されること（優先表示・重み低下のいずれも発生しない）
- [ ] `unset`ユーザーの床タスク提示は現行MVPと出力分布が変わらないこと（既存回帰条件の継続）

---

## 3. 購入検討者向け「迎える前チェック」（データ基盤のみ実装・画面は未着手）

### 3-1. 確定した設計方針

- **通常のタスク記録と完全分離する。** 以下の既存の値・ロジックには一切影響させない：通常タスクの完了数、ストリーク、今週の実施日数、14日クールダウン、通常タスクの完了率
- `taskStats`（`storage.ts`）は共用しない。「迎える前チェック」専用の記録先を別途新設する（キー名・データ構造は本書では未確定。実装時に`storage.ts`へ追加すること。例：`robotCheckStats`のような別ストレージキーを想定するが、`taskStats`とは型・保存キーとも独立させること）
- 計測は専用イベント3種のみを使う：`robot_check_started` / `robot_check_item_checked` / `robot_check_completed`（既存の`robot_task_shown`/`robot_task_completed`/`robot_task_skipped`は転用しない。C区分タスクはこの独立フローの対象であり、通常のタスク選択ロジックの計測対象からは外れている）

### 3-2. データソース

`taskData.ts`の`ROBOT_CHECK_TASKS`（6件、1-4章参照）をそのまま利用する。既存の`cooldownDays`等のフィールドは流用可能だが、独立フローが「一度使う」性質のものである以上、クールダウンによる再提示制御を適用するかどうかは画面設計時に改めて判断すること（適用しない＝毎回全件表示、という設計も候補になりうる）。

### 3-3. 本書時点での未確定事項（画面実装着手前に確認）

- 画面構成・状態遷移（単一画面で6件をチェックリスト式に見せるのか、1件ずつ遷移するのか）
- `robot_check_item_checked`が発火する粒度（チェック項目1つごとか、確認して次に進むごとか）
- 「迎える前チェック」への入り口（ホーム画面のどこから開始するか）。現状、購入検討者向けの導線はホーム画面上に存在しないため、新規に導線を追加する必要がある
- クールダウンの要否（3-2参照）

**この3章の画面・状態遷移・ストレージ実装は今回のスコープでは未着手。** データ基盤（`ROBOT_CHECK_TASKS`）のみ用意済みであり、着手する際は上記の未確定事項を先に解消すること。

---

## 4. ショートカット「ロボット掃除機前の5分」の非表示化（実装済み）

### 4-1. 変更箇所

`App.js:815`を以下のとおり変更した。

```js
// 変更前
const showRobotShortcut = robotVacuumPrefs?.robotVacuumStatus === "owner";

// 変更後（改訂版6章：今回のリリースでは非表示。コードは残し導線のみ隠す）
const showRobotShortcut = false;
```

### 4-2. 変更していないコード（削除しない）

- `RobotShortcutCard`コンポーネント定義（`App.js:466-479`）
- `chooseRobotOwnerShortcut`（`App.js:1046-1064`）
- `CategoryScreen`本体・propsの受け渡し（`App.js:481-551`, `1158-1159`）
- `taskPicker.ts`の`pickRobotOwnerFloorTask`・`audienceFilter`経路

`showRobotShortcut`は1つのpropsとして`CategoryScreen`にそのまま流れ続けるため、`CategoryScreen`のJSX構造・props列には一切手を入れていない。`docs/STASH_NOTES.md`記載のとおり、この変更はヘルプ画面/おすすめカードのstash由来コードとは物理的に別の行（`App.js:815`のみ）で完結している。

### 4-3. 受け入れ条件

- [x] `robotVacuumStatus === "owner"`のユーザーでも、ホーム画面にショートカットカードが表示されない
- [x] `RobotShortcutCard`・`chooseRobotOwnerShortcut`・`pickRobotOwnerFloorTask`のコード自体は削除されていない
- [x] 既存のユニットテスト（`pickRobotOwnerFloorTask`単体のテスト）はUI表示条件と独立しているため影響を受けない

### 4-4. 今回のスコープ外（改訂版6章・7章）

- 「低優先度で残す」形（写真・タイマー不要の1画面完結の簡易版への作り直し）は実施しない
- 「出かける前リセット」等の一括行動向け簡易モード（7章）の新規実装は実施しない

---

## 5. 計測イベント（変更不要・追加分は3章参照）

既存10イベント（`robot_status_set`/`robot_prompt_shown`/`robot_prompt_dismissed`/`robot_task_shown`/`robot_task_completed`/`robot_task_skipped`/`task_hidden`/`task_unhidden`/`robot_shortcut_opened`/`task_pool_fallback`）は**コード変更不要**。

| イベント | 本リリースでの扱い |
|---|---|
| `robot_prompt_shown` / `robot_prompt_dismissed` | 継続。コード変更なし |
| `task_unhidden` / `task_pool_fallback` | 継続。コード変更なし |
| `robot_shortcut_opened` | 定義・呼び出しコードとも変更不要。4章の変更（`showRobotShortcut = false`）により`chooseRobotOwnerShortcut`が呼ばれなくなるため、結果として自然に発火しなくなるだけ |
| `robot_task_shown` | コード変更不要。ただし1章のデータ仕分けにより、`audiences`を持つのはB区分10件のみになったため、**発火対象がB区分タスクに限定される**（A区分は通常タスク化により対象外、C区分は`TASKS.floor`から除去済みのため通常選択で選ばれること自体がなくなる）。これはロジック上の意図した帰結であり、コード側の追加対応は不要 |
| `robot_task_completed` / `robot_task_skipped` | 同上（B区分限定になるのは仕様どおりの帰結） |

`robot_check_started` / `robot_check_item_checked` / `robot_check_completed`（3章、C区分の独立フロー用）は**新規イベントであり未実装**。3章の画面実装時に`analytics.ts`へ追加すること。

---

## 6. スコープ外（今回は実装しない）

- ロボット掃除機の商品紹介／購入リンク／アフィリエイト／成果報酬計測
- メーカー広告・メーカーアカウント連携
- ロボット掃除機の直接操作・状態取得・部屋マップ取得
- AI画像解析
- 一般ユーザー向け「目的を選ぶ」モード
- 詳細な生活環境アンケート
- 課金機能
- 所有者向けの大量専用タスクの新規追加
- 「ロボット掃除機前の5分」ショートカットの作り直し（4-4参照）
- 「出かける前リセット」等の一括行動向け簡易モードの新規実装（4-4参照）
- 購入検討者向け「迎える前チェック」の画面・状態遷移・ストレージ実装（3章、未確定事項の解消後に別途着手）

---

## 7. 実装順序（このリリース分の消化状況）

1. ~~ドキュメント改訂（要求定義書・実装指示書・タスク仕分けドラフト）~~ 完了
2. ~~`App.js:815`のショートカット非表示化~~ 完了（4章）
3. ~~タスク仕分け（1章）の企画・コンテンツ担当レビュー確定~~ 完了
4. ~~`taskData.ts`への反映（A/B/C区分）~~ 完了（1章）
5. ~~`taskPicker.ts`の重み付けロジック再設計~~ 完了（2章）
6. 回帰テスト一式の更新（`taskPicker.test.ts`/`taskData.test.ts`） — 次項参照
7. 購入検討者向け「迎える前チェック」独立フローの設計・実装（3章、別途詳細指示待ち・今回のスコープ外）

## 8. テスト方針（4章反映）

`taskPicker.test.ts`のうち、旧`ROBOT_AUDIENCE_WEIGHT_MULTIPLIER`による「owner/considering双方を持ち上げる」挙動を検証していたテスト（`describe.each(['owner',...],['considering',...])`のブロック）は、新ロジックに合わせて以下の観点で書き換えが必要：

- `owner` × B区分タスク：`unset`と比較して選択頻度が明確に下がること
- `considering` × B区分タスク：`unset`と選択頻度が変わらないこと（重み調整が一切効かないこと）
- `owner` × A区分タスク：優先表示（持ち上げ）も重み低下も発生しないこと（通常タスクと同じ扱い）

`taskData.test.ts`についても、A区分5件が`audiences`を持たないこと、C区分6件が`TASKS.floor`に含まれず`ROBOT_CHECK_TASKS`に存在すること、`findTaskById`がC区分のIDも解決できることを検証するケースを追加する。

---

## 9. 要確認事項（残・実装をブロックしない）

- 3章：「迎える前チェック」の画面構成・状態遷移・専用ストレージのキー設計
- 3章：`robot_check_item_checked`の発火粒度
- 3章：「迎える前チェック」への導線をホーム画面のどこに配置するか
- 2章：`ROBOT_OWNER_DEMOTION_MULTIPLIER = 0.5`は暫定値。リリース後の`robot_task_skipped`/`robot_task_completed`の推移を見て調整することを前提とする

上記はいずれも3章（迎える前チェックの新規実装）に関するものであり、既に反映済みの1・2・4章の内容には影響しない。

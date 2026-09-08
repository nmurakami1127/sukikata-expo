# EASビルド手順メモ（2026-08-14 実施分）

Android / iOS のEASクラウドビルドを実施した際の手順・設定・つまずきポイントの記録。
別セッションで同じ作業をする際はこのファイルを参照すること。

## 前提

- `eas.json` に既に本プロジェクトのEAS設定あり（projectId, owner: `nmurakami1127-team`）
- ログイン確認: `npx eas-cli whoami`（未ログインなら `npx eas-cli login`）
- iOS配布証明書・Androidキーストアは「Expo管理のリモートクレデンシャル」を使用しており、
  ローカルのApple ID対話ログインなしで非対話ビルドが通る状態になっている

## 1. Android — 実機に直接インストールできるAPK（社内配布・URL共有用）

```bash
npx eas-cli build --platform android --profile preview --non-interactive
```

- `eas.json` の `preview` プロファイルは `distribution: "internal"` のため、
  **デフォルトで `.apk` が出力される**（Google Playには使えない。下記2を参照）
- ビルド完了後、`eas-cli build:view <BUILD_ID> --json` の `artifacts.buildUrl` で
  ダウンロードURLを取得できる。このURLをそのままスマホのブラウザで開けばインストール可能

### つまずきポイント: `versionCode` の重複

`appVersionSource: "remote"` のため、Androidの `versionCode` はEASがリモートで管理している
（`app.json` には書かれていない）。`preview` プロファイルに `autoIncrement` が無いと、
毎回同じ `versionCode` でビルドされ、Google Play Consoleへのアップロード時に
「バージョン コードXはすでに使用されています」エラーになる。

**対処**: `eas.json` の `build.preview` に `"autoIncrement": true` を追加済み。
現在のリモートバージョンは `npx eas-cli build:version:get --platform android` で確認できる
（対話式の `build:version:set` は非対話環境からは使えないため、autoIncrementで解決した）。

## 2. Android — Google Play Console 提出用 App Bundle（.aab）

Google Play Consoleは（内部テストトラック含め）**`.apk` を受け付けず `.aab` が必須**。
`preview` プロファイル（distribution: internal）はAPKしか出さないため、
**`production` プロファイル**（`distribution` 未指定＝デフォルトの `store`）でビルドすると
自動的に `.aab` が出力される。

```bash
npx eas-cli build --platform android --profile production --non-interactive
```

このファイルをGoogle Play Consoleの該当トラック（内部テスト等）にアップロードする。

## 3. iOS — App Store配布用ビルド（UDID登録不要）

`eas.json` の `preview` プロファイル（Ad Hoc配布）は事前に端末UDIDを1台ずつ登録する必要があり手間が大きい。
UDID登録なしで配布したい場合は `production` プロファイル（App Store配布証明書）でビルドし、
TestFlight経由で配布する。

```bash
npx eas-cli build --platform ios --profile production --non-interactive
```

- 既存のApple Distribution証明書・Provisioning Profileがリモートに登録済みのため、
  対話でのApple IDログインなしでそのまま通る
- `buildNumber` は `production` プロファイルの `autoIncrement: true` により自動加算される

## 4. iOS — App Store Connect（TestFlight）への提出

```bash
npx eas-cli submit --platform ios --profile production --id <BUILD_ID> --non-interactive
```

### つまずきポイント: `ascAppId` 未設定

`eas.json` の `submit.production.ios` には `ascApiKeyPath` / `ascApiKeyId` / `ascApiKeyIssuerId`
（App Store Connect APIキー）はあったが、**提出先アプリを指定する `ascAppId` が無かった**ため、
非対話モードで以下のエラーになった。

```
Set ascAppId in the submit.json or re-run this command in interactive mode.
```

**対処**: 既存のAPIキーを使い、App Store Connect API (`GET /v1/apps?filter[bundleId]=<bundle id>`)
を直接叩いて `ascAppId` を取得し、`eas.json` に追記した（`com.sukikata.timerphoto` → `6799003966`）。
API呼び出し用のJWT署名は Node標準の `crypto` モジュール（ES256, `dsaEncoding: "ieee-p1363"`）で
その場で生成すれば、追加パッケージ不要でp8キーから署名できる。

提出後、Apple側の処理（5〜10分程度）が終わると以下でビルドが確認できる:
```
https://appstoreconnect.apple.com/apps/<ascAppId>/testflight/ios
```

そこから先（テストグループ作成、パブリックリンク発行など）はApp Store Connectの管理画面操作のみで、
CLIからは自動化できない。

## 現在の `eas.json` の要点

```jsonc
{
  "build": {
    "preview": { "distribution": "internal", "autoIncrement": true }, // apk, 直接配布用
    "production": { "autoIncrement": true } // aab / iOSはApp Store配布, ストア・TestFlight用
  },
  "submit": {
    "production": {
      "ios": {
        "ascApiKeyPath": "./secrets/AuthKey_YYMQ276FU3.p8",
        "ascApiKeyId": "YYMQ276FU3",
        "ascApiKeyIssuerId": "8f59ff9b-c38f-440c-aeb6-835b367e0fed",
        "ascAppId": "6799003966"
      }
    }
  }
}
```

## ビルド状況の確認コマンド

```bash
# ビルド一覧・詳細
npx eas-cli build:view <BUILD_ID> --json

# Androidのリモートversion確認
npx eas-cli build:version:get --platform android
```

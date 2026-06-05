# meet-attendance-slack

特定の Google Meet の **入退室（join / leave）をリアルタイムで Slack に投稿** する Google Apps Script（clasp / TypeScript）。

**個人 Gmail** と **Google Workspace** の両方に対応し、認可方式を `AUTH_MODE` で切り替えられます。

```
Meet 入退室 → Workspace Events API(購読) → Cloud Pub/Sub(push) → GAS WebApp(doPost) → Slack
```

---

## 「他人が主催する Meet」をどう監視するか

入退室イベントを受け取れるのは **その Meet のオーナー本人の認可** が必要です（招待者・共同主催では取得不可）。本リポジトリは、その「主催者の認可」を 2 方式で吸収します。

| 方式 | `AUTH_MODE` | 個人Gmail | Workspace | 主催者が他人のとき |
|---|---|:---:|:---:|---|
| 主催者本人が OAuth 同意 | `oauth` | ◯ | ◯ | **主催者本人に認可 URL を開いて同意してもらう** |
| サービスアカウント + ドメイン全体委任 | `dwd` | ✕ | ◯ | **同じ組織内なら同意不要で自動カバー** |

- 社外/個人の主催者が混ざる → `oauth`
- すべて自組織内の主催者 → `dwd`（管理者が一度許可すれば無人運用）

監視対象は **主催者をユーザー単位で購読** するので、その人がオーナーの全 Meet（特定の会議コードを含む）を自動でカバーします。

---

## 必要なもの

- [mise](https://mise.jdx.dev)（`node` と `gcloud` を自動導入。`clasp` は npm 依存）
- GCP プロジェクト（Pub/Sub 用、課金有効化推奨）
- Slack Incoming Webhook URL
- `oauth` 方式: OAuth クライアント（ウェブ アプリ）
- `dwd` 方式: サービスアカウント + 管理コンソールでのドメイン全体委任（Workspace 管理者権限）

---

## セットアップ（スクリプト化）

CLI で自動化できる工程はスクリプト化済みです。**ブラウザ操作が必須の数ステップだけ**手で行います
（OAuth 同意画面・OAuth クライアント作成・各種ログイン・主催者の同意などは Google がブラウザを要求するため、完全自動化はできません）。

### クイックスタート
```bash
# 1) 設定ファイルを作成して値を入れる
cp .env.example .env
$EDITOR .env        # GCP_PROJECT_ID, OAUTH_CLIENT_ID/SECRET, SLACK_WEBHOOK_URL, HOSTS など

# 2) 一括セットアップ（途中、手動ステップは案内されて一時停止する）
mise run setup

# 3) 主催者が認可URLで同意したのち、購読を作成
mise run subscribe
```

`mise run setup` が行うこと:
1. `mise install`（node / gcloud）+ `npm ci`
2. `.env` 検証、`clasp` / `gcloud` ログイン確認
3. **手動ステップの案内**（Apps Script API 有効化 / OAuth 同意画面 / OAuth クライアント / GCP 紐付け）
4. `scripts/gcp-setup.sh` … API 有効化・Pub/Sub トピック作成・**IAM 付与（コンソールUIが弾く箇所）**
5. `scripts/deploy.sh` … `clasp push` → Web App デプロイ → **Pub/Sub push 購読作成**

設定は `.env` → ビルド時に生成される `ENV` 定数経由で読み込むため、**`clasp push` だけで反映**されます
（`initProperties` の手動実行は不要。Script Properties で個別上書きも可能）。

### タスク一覧（`mise tasks`）
| タスク | 用途 |
|---|---|
| `mise run setup` | 一括セットアップ（手動箇所は案内） |
| `mise run gcp` | GCP プロビジョニングのみ（冪等） |
| `mise run deploy` | build → push → デプロイ → push購読 |
| `mise run subscribe` | 主催者同意確認 → 購読作成 → 更新トリガー |
| `mise run auth` | clasp / gcloud ログイン状態の確認 |
| `mise run build` | TypeScript ビルド |

### 方式B（`dwd`・Workspace）の追加手順
`.env` で `AUTH_MODE=dwd` とし、`SA_CLIENT_EMAIL` / `SA_PRIVATE_KEY` を設定。さらに管理コンソールで
**ドメイン全体の委任**にサービスアカウントのクライアント ID とスコープ
`https://www.googleapis.com/auth/meetings.space.readonly` を登録（これはブラウザ手動）。以降は同じく `mise run setup`。

### 動作確認
- Slack テスト投稿: `npx clasp run testSlack`（または エディタで `testSlack` 実行）
- 対象主催者の Meet に入室 → Slack に「入室しました」通知が出れば成功

---

## 主要関数（`clasp run` または GASエディタで実行）

| 関数 | 用途 |
|---|---|
| `showPendingAuthorizations()` | (oauth) 未認可主催者の認可 URL を表示 |
| `createAllSubscriptions()` | 全主催者の購読を作成 |
| `renewAllSubscriptions()` | 購読の TTL を延長（トリガーで自動実行） |
| `deleteAllSubscriptions()` | 購読を全削除 |
| `installRenewTrigger()` | 更新トリガーを登録 |
| `testSlack()` | Slack 接続テスト |
| `initProperties()` | （任意）ENV 値を Script Properties へ複製 |

---

## ディレクトリ構成
```
mise.toml              ツール宣言（node/gcloud）+ タスク定義
.env.example           設定テンプレ（cp して .env を作る／.env は gitignore）
scripts/
  setup.sh             一括セットアップ（手動箇所は案内して停止）
  gcp-setup.sh         GCP 自動プロビジョニング（API/トピック/IAM・冪等）
  deploy.sh            build → clasp push → デプロイ → push購読
  subscribe.sh         主催者同意確認 → 購読作成 → 更新トリガー
  auth-check.sh        clasp/gcloud ログイン確認
  gen-env.mjs          .env → gitignore された src/env.local.ts を生成
  lib.sh               共通ヘルパー
src/
  config.ts            設定解決（ENV → Script Properties の順）
  auth/
    authProvider.ts    認可の共通IF (oauth/dwd を委譲)
    oauthProvider.ts   方式A: 主催者本人の OAuth 同意
    dwdProvider.ts     方式B: SA + ドメイン委任 (JWT 自己生成)
  subscriptions.ts     購読の作成/更新/削除
  meet.ts              参加者の表示名解決 (Meet REST API)
  slack.ts             Slack Webhook 投稿 + 文面整形
  webapp.ts            doPost(Pub/Sub受信) / doGet(認可CB)
  setup.ts             運用関数（購読/トリガー/テスト）
  env.local.ts         ★生成物・gitignore（.env から）
```

---

## 注意点・既知の制約
- **共同主催では不可**: API 上、入退室は会議オーナーのみ取得可能。
- **二重投稿の可能性**: GAS Web App は任意の HTTP ステータスを返せず、エラー時は例外再スローで Pub/Sub に再送させる設計。再送時に二重投稿が起き得る（文面の冪等性は許容）。必要なら `messageId` の重複排除を `CacheService` で実装。
- **TTL 更新必須**: トリガー未登録だと数日で購読が失効する。
- **プライバシー**: 参加者の入退室を記録・通知するため、参加者への事前周知・同意を推奨。
- **スコープの厳密確認**: Meet 参加者イベントの必要スコープは Google のドキュメント（[events-meet](https://developers.google.com/workspace/events/guides/events-meet)）で最新を確認のこと。

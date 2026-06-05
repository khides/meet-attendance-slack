# meet-attendance-slack

特定の Google Meet の **入退室（join / leave）をリアルタイムで Slack に投稿** する Google Apps Script（clasp / TypeScript）。

**個人 Gmail** と **Google Workspace** の両方に対応し、認可方式を `AUTH_MODE` で切り替えられます。

```
Meet 入退室
  → Workspace Events API（空間単位の購読）
    → Cloud Pub/Sub（pull 購読）
      → GAS 1分ポーリング（pollPubsub）
        → Slack
```

> **push を使わない理由**: GAS Web App の `/exec` は 302 リダイレクトを返すため Pub/Sub の push エンドポイントにできない（2xx を返せず無限再送ループになる）。1分毎の時間トリガーで pull する設計を採用。

---

## 「他人が主催する Meet」をどう監視するか

入退室イベントを受け取れるのは **その Meet のオーナー本人の認可** が必要です（招待者・共同主催では取得不可）。本リポジトリは「主催者の認可」を 2 方式で吸収します。

| 方式 | `AUTH_MODE` | 個人Gmail | Workspace | 主催者が他人のとき |
|---|---|:---:|:---:|---|
| 主催者本人が OAuth 同意 | `oauth` | ◯ | ◯ | **主催者本人に認可 URL を開いて同意してもらう** |
| サービスアカウント + ドメイン全体委任 | `dwd` | ✕ | ◯ | **同じ組織内なら同意不要で自動カバー** |

- 社外/個人の主催者が混ざる → `oauth`
- すべて自組織内の主催者 → `dwd`（管理者が一度許可すれば無人運用）

監視対象の会議コードは `TARGET_MEETING_CODES` で指定します（スペース単位の購読に変換）。
空にすると主催者の全会議をカバー（Cloud Identity が必要＝Workspace 向け）。

---

## 必要なもの

- [mise](https://mise.jdx.dev)（`node` と `gcloud` を自動導入。`clasp` は npm 依存）
- GCP プロジェクト（Pub/Sub 用、課金有効化推奨）
- Slack Incoming Webhook URL
- `oauth` 方式: OAuth クライアント（ウェブ アプリ）
- `dwd` 方式: サービスアカウント + 管理コンソールでのドメイン全体委任（Workspace 管理者権限）

---

## セットアップ

CLI で自動化できる工程はスクリプト化済みです。**ブラウザ操作が必須の数ステップだけ**手で行います。

### 1. 設定ファイルを作成

```bash
cp .env.example .env
$EDITOR .env
```

`.env` に以下を設定します（[.env.example](.env.example) に全キーのテンプレートあり）：

| キー | 例 | 説明 |
|---|---|---|
| `GCP_PROJECT_ID` | `meet-attendance-slack` | GCP プロジェクト ID |
| `PUBSUB_TOPIC` | `meet-events` | Pub/Sub トピック名 |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/...` | Incoming Webhook URL |
| `HOSTS` | `you@gmail.com` | 監視対象の会議オーナー（カンマ区切り） |
| `TARGET_MEETING_CODES` | `ddd-eeee-fff` | 監視対象の会議コード（カンマ区切り、空=全会議） |
| `AUTH_MODE` | `oauth` | `oauth` または `dwd` |
| `OAUTH_CLIENT_ID` | `1234...apps.googleusercontent.com` | OAuth クライアント ID（方式A） |
| `OAUTH_CLIENT_SECRET` | `GOCSPX-...` | OAuth クライアントシークレット（方式A） |

### 2. 一括セットアップ（CLI 自動化部分）

```bash
mise run setup
```

途中でブラウザ操作が必要な箇所は案内して一時停止します。

`mise run setup` が実行する内容:
1. `mise install`（node / gcloud）+ `npm ci`
2. `.env` の検証
3. **[手動] Apps Script API 有効化** → [script.google.com/home/usersettings](https://script.google.com/home/usersettings) で「Google Apps Script API」を ON
4. `clasp login`（Google アカウントでログイン）
5. **[手動] OAuth 同意画面の設定** → GCP コンソールで「外部」または「内部」で作成
6. **[手動] OAuth クライアント（ウェブ アプリ）作成** → クライアント ID / シークレットを `.env` に記入
7. **[手動] GCP プロジェクトを Apps Script に紐付け** → [スクリプトの設定](https://script.google.com) > Google Cloud Platform プロジェクト > プロジェクト番号を入力
8. `scripts/gcp-setup.sh` … API 有効化・Pub/Sub トピック作成・IAM 付与
9. `scripts/deploy.sh` … `clasp push` → Web App デプロイ → **Pub/Sub pull 購読作成**

> **IAM の注意**: Workspace Events API に必要な `meet-api-event-push@system.gserviceaccount.com` は Google 管理のシステム SA のため、GCP コンソールの UI から付与できないケースがあります。スクリプト内で `gcloud` CLI を使って付与します。

### 3. GAS エディタでの手動実行（初回のみ）

`clasp push` 後、[script.google.com](https://script.google.com) を開き、以下の関数を順番に実行します。

#### 3-1. 購読の作成

```
createAllSubscriptions()
```

`TARGET_MEETING_CODES` が設定されていれば、会議コードを Meet API でスペース ID に変換し、**スペース単位**の Workspace Events 購読を作成します。個人 Gmail でも動作します。

> エラーが出た場合は `showPendingAuthorizations()` を実行して、主催者の認可 URL を開いてもらい、再実行してください。

#### 3-2. ポーリングトリガーの登録

```
installPollTrigger()
```

`pollPubsub` を **1分毎**に実行する時間トリガーを登録します。これで Pub/Sub から自動でメッセージを取得し Slack に投稿されます。

#### 3-3. 購読更新トリガーの登録

```
installRenewTrigger()
```

購読には TTL があります。**12時間毎**に `renewAllSubscriptions` を実行するトリガーを登録して自動延長します。

### 4. 動作確認

対象の Google Meet に入室 → Slack に「入室しました」通知が届けば成功です。

```bash
# Slack 接続テスト（GAS エディタか clasp run で実行）
# testSlack()
```

---

## タスク一覧（`mise tasks`）

| タスク | 用途 |
|---|---|
| `mise run setup` | 一括セットアップ（手動箇所は案内） |
| `mise run gcp` | GCP プロビジョニングのみ（冪等） |
| `mise run deploy` | build → push → デプロイ → pull 購読作成 |
| `mise run subscribe` | 主催者同意確認 → 購読作成 → 更新トリガー |
| `mise run auth` | clasp / gcloud ログイン状態の確認 |
| `mise run build` | TypeScript ビルド |

---

## 方式B（`dwd`・Workspace のみ）の追加手順

1. `.env` で `AUTH_MODE=dwd` に変更
2. `SA_CLIENT_EMAIL` / `SA_PRIVATE_KEY` を設定（サービスアカウントの JSON キーから取得）
3. Google Workspace 管理コンソール > セキュリティ > API の制御 > ドメイン全体の委任 に以下を登録:
   - クライアント ID: サービスアカウントのクライアント ID
   - スコープ: `https://www.googleapis.com/auth/meetings.space.readonly`
4. 以降は同じく `mise run setup`

---

## 主要関数（GAS エディタで実行）

| 関数 | 用途 |
|---|---|
| `createAllSubscriptions()` | 購読を作成（初回・再作成時） |
| `installPollTrigger()` | Pub/Sub 1分毎ポーリングトリガーを登録 |
| `installRenewTrigger()` | 購読更新トリガーを登録（12h毎） |
| `showPendingAuthorizations()` | (oauth) 未認可主催者の認可 URL を表示 |
| `renewAllSubscriptions()` | 購読の TTL を手動延長 |
| `deleteAllSubscriptions()` | 購読を全削除（リセット時） |
| `testSlack()` | Slack 接続テスト |
| `pollPubsub()` | Pub/Sub を手動で1回ポーリング（デバッグ用） |

---

## ディレクトリ構成

```
mise.toml              ツール宣言（node/gcloud）+ タスク定義
.env.example           設定テンプレ（cp して .env を作る／.env は gitignore）
scripts/
  setup.sh             一括セットアップ（手動箇所は案内して停止）
  gcp-setup.sh         GCP 自動プロビジョニング（API/トピック/IAM・冪等）
  deploy.sh            build → clasp push → デプロイ → pull 購読作成
  subscribe.sh         主催者同意確認 → 購読作成 → 更新トリガー
  auth-check.sh        clasp/gcloud ログイン確認
  gen-env.mjs          .env → gitignore された src/env.local.ts を生成
  lib.sh               共通ヘルパー
src/
  config.ts            設定解決（ENV → Script Properties の順）
  events.ts            Pub/Sub メッセージの処理・Slack 投稿ロジック
  pull.ts              Pub/Sub pull ポーリング + トリガー管理
  subscriptions.ts     購読の作成/更新/削除
  meet.ts              参加者の表示名解決 (Meet REST API)
  slack.ts             Slack Webhook 投稿 + 文面整形
  webapp.ts            doGet（OAuth コールバック用のみ）
  setup.ts             運用関数（購読/トリガー/テスト）
  auth/
    authProvider.ts    認可の共通IF（実行ユーザー自身なら ScriptApp.getOAuthToken 優先）
    oauthProvider.ts   方式A: 主催者本人の OAuth 同意（apps-script-oauth2）
    dwdProvider.ts     方式B: SA + ドメイン委任 (JWT 自己生成)
  env.local.ts         ★生成物・gitignore（.env から自動生成）
```

---

## アーキテクチャの詳細

### イベントフロー

```
1. Meet で入退室発生
2. Workspace Events API が ce-type=google.workspace.meet.participant.v2.joined/left を
   Cloud Pub/Sub トピックに発行
3. GAS の pollPubsub()（1分毎トリガー）が pull 購読からメッセージを取得
4. events.ts の handlePubsubMessage() がメッセージを解析:
   - ce-subject から spaces/{id} を取得
   - Meet API で meetingCode を解決（例: ddd-eeee-fff）
   - TARGET_MEETING_CODES でフィルタ
   - participantSession.name から participant リソースを取得
   - Meet API で表示名を解決
5. Slack Incoming Webhook に投稿
6. messageId を CacheService に記録（重複投稿防止）
```

### 購読の種類

| 状況 | 購読の targetResource | 備考 |
|---|---|---|
| `TARGET_MEETING_CODES` あり | `//meet.googleapis.com/spaces/{id}` | 個人 Gmail でも動作 |
| `TARGET_MEETING_CODES` 空 | `//cloudidentity.googleapis.com/users/me` | Workspace のみ |

---

## 注意点・既知の制約

- **共同主催では不可**: API 上、入退室は会議オーナーのみ取得可能。
- **最大 1分の遅延**: Pub/Sub から pull するため、イベント発生から最大1分後に通知される。
- **messageId による重複排除**: `CacheService`（6時間保持）で重複投稿を防いでいるが、スクリプト再起動直後は稀に二重投稿の可能性あり。
- **TTL 更新必須**: `installRenewTrigger()` 未登録だと購読が数日で失効する。
- **個人 Gmail の制限**: `TARGET_MEETING_CODES` 指定が必須。ユーザー単位購読（全会議一括）は Cloud Identity が必要なため個人 Gmail では使えない。
- **プライバシー**: 参加者の入退室を記録・通知するため、参加者への事前周知・同意を推奨。

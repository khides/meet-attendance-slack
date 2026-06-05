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

- Node.js / `npm i -g @google/clasp`
- GCP プロジェクト（Pub/Sub 用、課金有効化推奨）
- Slack Incoming Webhook URL
- `oauth` 方式: OAuth クライアント（ウェブ アプリ）
- `dwd` 方式: サービスアカウント + 管理コンソールでのドメイン全体委任（Workspace 管理者権限）

---

## セットアップ手順

### 1. clasp プロジェクト作成
```bash
npm install
clasp login
clasp create --type standalone --title "meet-attendance-slack" --rootDir dist
# 生成された scriptId を .clasp.json に反映
npm run push
```

### 2. GCP プロジェクトと Pub/Sub
1. GCP で **Cloud Pub/Sub API** と **Google Workspace Events API**、**Google Meet API** を有効化。
2. トピックを作成（例 `meet-events`）。
3. Workspace Events のサービスアカウントに publish 権限を付与:
   - トピックの IAM に `meet-api-event-pusher@system.gserviceaccount.com` を **Pub/Sub パブリッシャー** として追加。
4. この GCP プロジェクトを、Apps Script の「プロジェクトの設定 → Google Cloud Platform プロジェクト」に紐付ける（同意画面のため）。

### 3. Web App をデプロイ
```bash
npm run deploy
```
- 公開された `…/exec` URL を控える（Pub/Sub の push 先になる）。
- `appsscript.json` の webapp access は `ANYONE_ANONYMOUS`。

### 4. Pub/Sub push 購読を作成
トピックに対し、push エンドポイント = WebApp の `exec` URL を指定して push サブスクリプションを作成。
```bash
gcloud pubsub subscriptions create meet-events-push \
  --topic=meet-events \
  --push-endpoint="https://script.google.com/macros/s/XXX/exec?token=YOUR_SHARED_TOKEN"
```
- `?token=` は簡易検証用（`PUSH_SHARED_TOKEN` と一致させる）。本番では OIDC + 別経路の検証を検討。

### 5. 認可方式ごとの設定

#### 方式A: `oauth`（個人Gmail / 社外主催者OK）
1. GCP で OAuth クライアント（**ウェブ アプリケーション**）を作成。
   - 承認済みリダイレクト URI に WebApp の `…/usercallback` または `…/exec` を登録（apps-script-oauth2 の仕様に従う）。
2. `src/setup.ts` の `initProperties()` に値を入れて一度実行（`AUTH_MODE=oauth`, `OAUTH_CLIENT_ID/SECRET`, `HOSTS`, `SLACK_WEBHOOK_URL`, `GCP_PROJECT_ID`, `PUBSUB_TOPIC`）。
3. `showPendingAuthorizations()` を実行 → ログに出る URL を **各主催者本人** に開いてもらい同意。
4. `createAllSubscriptions()` を実行。

#### 方式B: `dwd`（Workspace・組織内全主催者を無人カバー）
1. サービスアカウントを作成し JSON 鍵を取得。
2. 管理コンソール → セキュリティ → アクセスとデータ管理 → API の制御 → **ドメイン全体の委任** に、
   SA のクライアント ID と スコープ `https://www.googleapis.com/auth/meetings.space.readonly` を登録。
3. `initProperties()` で `AUTH_MODE=dwd`, `SA_CLIENT_EMAIL`, `SA_PRIVATE_KEY`, `HOSTS` などを設定。
4. `createAllSubscriptions()` を実行（同意 URL は不要）。

### 6. 購読の自動更新
購読には TTL があるため、`installRenewTrigger()` を一度実行して 12 時間毎の `renewAllSubscriptions` トリガーを登録。

### 7. 動作確認
- `testSlack()` で Slack 投稿を確認。
- 対象主催者の Meet に入室 → Slack に「入室しました」通知が出れば成功。

---

## 主要関数（GASエディタから手動実行）

| 関数 | 用途 |
|---|---|
| `initProperties()` | Script Properties をまとめて投入 |
| `showPendingAuthorizations()` | (oauth) 未認可主催者の認可 URL を表示 |
| `createAllSubscriptions()` | 全主催者の購読を作成 |
| `renewAllSubscriptions()` | 購読の TTL を延長（トリガーで自動実行） |
| `deleteAllSubscriptions()` | 購読を全削除 |
| `installRenewTrigger()` | 更新トリガーを登録 |
| `testSlack()` | Slack 接続テスト |

---

## ディレクトリ構成
```
src/
  config.ts            Script Properties 読み出し / 定数
  auth/
    authProvider.ts    認可の共通IF (oauth/dwd を委譲)
    oauthProvider.ts   方式A: 主催者本人の OAuth 同意
    dwdProvider.ts     方式B: SA + ドメイン委任 (JWT 自己生成)
  subscriptions.ts     購読の作成/更新/削除
  meet.ts              参加者の表示名解決 (Meet REST API)
  slack.ts             Slack Webhook 投稿 + 文面整形
  webapp.ts            doPost(Pub/Sub受信) / doGet(認可CB)
  setup.ts             初期化・トリガー・テスト
```

---

## 注意点・既知の制約
- **共同主催では不可**: API 上、入退室は会議オーナーのみ取得可能。
- **二重投稿の可能性**: GAS Web App は任意の HTTP ステータスを返せず、エラー時は例外再スローで Pub/Sub に再送させる設計。再送時に二重投稿が起き得る（文面の冪等性は許容）。必要なら `messageId` の重複排除を `CacheService` で実装。
- **TTL 更新必須**: トリガー未登録だと数日で購読が失効する。
- **プライバシー**: 参加者の入退室を記録・通知するため、参加者への事前周知・同意を推奨。
- **スコープの厳密確認**: Meet 参加者イベントの必要スコープは Google のドキュメント（[events-meet](https://developers.google.com/workspace/events/guides/events-meet)）で最新を確認のこと。

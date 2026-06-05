/**
 * 設定値はソースに直書きせず Script Properties に保存する。
 * プロジェクトの設定 → スクリプト プロパティ で登録するか、
 * setup.ts の `initProperties()` を一度実行して投入する。
 *
 * 必須キー:
 *   AUTH_MODE              "oauth" | "dwd"   認可方式の切替
 *   GCP_PROJECT_ID         Pub/Sub トピックのある GCP プロジェクト
 *   PUBSUB_TOPIC           例: "meet-events"  (トピック名のみ)
 *   SLACK_WEBHOOK_URL      Slack Incoming Webhook の URL
 *   HOSTS                  監視する主催者メールのカンマ区切り
 *                          例: "alice@example.com,bob@gmail.com"
 *
 * OAuth (AUTH_MODE=oauth) のとき:
 *   OAUTH_CLIENT_ID
 *   OAUTH_CLIENT_SECRET
 *
 * DWD (AUTH_MODE=dwd, Workspace のみ) のとき:
 *   SA_CLIENT_EMAIL        サービスアカウントのメール
 *   SA_PRIVATE_KEY         サービスアカウント秘密鍵 (PEM, 改行は \n のまま可)
 *
 * doPost 検証用 (任意だが推奨):
 *   PUBSUB_AUDIENCE        Pub/Sub push の OIDC トークン aud (= Web App URL)
 */

type AuthMode = "oauth" | "dwd";

/**
 * 設定値の解決順:
 *   1. ビルド時に .env から生成される ENV 定数（gitignore 済み src/env.local.ts）
 *   2. Script Properties（手動で上書きしたい場合のフォールバック）
 * → ENV を使えば `clasp push` だけで設定が反映され、initProperties 実行は不要。
 */
function resolve(key: string): string | null {
  if (typeof ENV !== "undefined" && ENV[key] !== undefined && ENV[key] !== "") {
    return ENV[key];
  }
  return PropertiesService.getScriptProperties().getProperty(key);
}

function prop(key: string): string {
  const v = resolve(key);
  if (v === null || v === "") {
    throw new Error(`設定値 "${key}" が未設定です（.env もしくは Script Properties を確認）`);
  }
  return v;
}

function propOptional(key: string): string | null {
  return resolve(key);
}

const Config = {
  authMode(): AuthMode {
    return prop("AUTH_MODE") as AuthMode;
  },
  gcpProjectId(): string {
    return prop("GCP_PROJECT_ID");
  },
  pubsubTopicPath(): string {
    return `projects/${prop("GCP_PROJECT_ID")}/topics/${prop("PUBSUB_TOPIC")}`;
  },
  /** pull 購読名（既定: <topic>-pull、PUBSUB_SUBSCRIPTION で上書き可）。 */
  pubsubSubscriptionName(): string {
    return propOptional("PUBSUB_SUBSCRIPTION") || `${prop("PUBSUB_TOPIC")}-pull`;
  },
  pubsubSubscriptionPath(): string {
    return `projects/${prop("GCP_PROJECT_ID")}/subscriptions/${this.pubsubSubscriptionName()}`;
  },
  slackWebhookUrl(): string {
    return prop("SLACK_WEBHOOK_URL");
  },
  hosts(): string[] {
    return prop("HOSTS")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  },
  oauthClientId(): string {
    return prop("OAUTH_CLIENT_ID");
  },
  oauthClientSecret(): string {
    return prop("OAUTH_CLIENT_SECRET");
  },
  saClientEmail(): string {
    return prop("SA_CLIENT_EMAIL");
  },
  saPrivateKey(): string {
    return prop("SA_PRIVATE_KEY").replace(/\\n/g, "\n");
  },
  pubsubAudience(): string | null {
    return propOptional("PUBSUB_AUDIENCE");
  },
  /**
   * 監視対象の会議コード（meet.google.com/【ここ】）のリスト。
   * 空なら HOSTS が主催する全会議を対象にする。
   * 比較はハイフン等を無視（aaa-bbbb-ccc も abtxyyxicf も一致）。
   */
  targetMeetingCodes(): string[] {
    const v = propOptional("TARGET_MEETING_CODES");
    if (!v) return [];
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  },
  /**
   * 会議コードごとの Slack Webhook URL マッピング。
   * 形式: "abc-def-ghi=https://hooks.slack.com/..., xyz-uvw-rst=https://..."
   *   ・会議コードと URL を = で区切る
   *   ・エントリ間は , で区切る（URL に , は含まれない）
   * 未設定の会議は slackWebhookUrl()（デフォルト）にフォールバック。
   */
  meetingSlackMap(): { [normCode: string]: string } {
    const v = propOptional("MEETING_SLACK_MAP");
    const map: { [normCode: string]: string } = {};
    if (!v) return map;
    for (const entry of v.split(",")) {
      const eq = entry.indexOf("=");
      if (eq === -1) continue;
      const code = normMeetingCode(entry.slice(0, eq).trim());
      const url = entry.slice(eq + 1).trim();
      if (code && url.startsWith("http")) map[code] = url;
    }
    return map;
  },
};

/** 会議コードを比較用に正規化（小文字・英数字のみ）。 */
function normMeetingCode(code: string): string {
  return (code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 購読する Meet イベント種別 */
const MEET_EVENT_TYPES = [
  "google.workspace.meet.participant.v2.joined",
  "google.workspace.meet.participant.v2.left",
];

/** Meet 参加者イベント購読に必要なスコープ */
const MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";

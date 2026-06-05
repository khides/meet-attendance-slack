/**
 * 初期化・運用ユーティリティ。エディタから手動実行する想定。
 */

/**
 * Script Properties をまとめて投入する。
 * 値を埋めてから一度だけ実行し、実行後はこの関数の中身を空に戻すこと
 * (秘密情報をソースに残さない)。
 */
function initProperties(): void {
  const props: { [k: string]: string } = {
    AUTH_MODE: "oauth", // "oauth" | "dwd"
    GCP_PROJECT_ID: "",
    PUBSUB_TOPIC: "meet-events",
    SLACK_WEBHOOK_URL: "",
    HOSTS: "", // "alice@example.com,bob@gmail.com"

    // --- AUTH_MODE=oauth のとき ---
    OAUTH_CLIENT_ID: "",
    OAUTH_CLIENT_SECRET: "",

    // --- AUTH_MODE=dwd のとき (Workspace) ---
    // SA_CLIENT_EMAIL: "",
    // SA_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",

    // --- push 検証 (任意) ---
    // PUSH_SHARED_TOKEN: "ランダムな秘密文字列",
    // PUBSUB_AUDIENCE: "https://script.google.com/macros/s/XXX/exec",
  };
  const store = PropertiesService.getScriptProperties();
  Object.keys(props).forEach((k) => {
    if (props[k] !== "") store.setProperty(k, props[k]);
  });
  Logger.log("Script Properties を更新しました");
}

/**
 * 方式A(OAuth) で、未認可の主催者の認可 URL を一覧表示する。
 * 出力された URL を各主催者本人に開いてもらい同意させる。
 */
function showPendingAuthorizations(): void {
  const pending = pendingAuthorizations();
  if (pending.length === 0) {
    Logger.log("未認可の主催者はいません。");
    return;
  }
  pending.forEach((p) => Logger.log(`${p.userEmail}:\n${p.authUrl}\n`));
}

/** 購読更新の時間トリガー(12時間毎)を登録する。一度だけ実行。 */
function installRenewTrigger(): void {
  // 二重登録を避ける
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "renewAllSubscriptions")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("renewAllSubscriptions")
    .timeBased()
    .everyHours(12)
    .create();
  Logger.log("renewAllSubscriptions の12時間トリガーを登録しました");
}

/** 動作確認用: Slack にテスト投稿する。 */
function testSlack(): void {
  postToSlack(":white_check_mark: meet-attendance-slack 接続テスト");
}

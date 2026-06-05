/**
 * 初期化・運用ユーティリティ。エディタから手動実行する想定。
 */

/**
 * Script Properties をまとめて投入する。
 * 値は .env（gitignore済み）に置き、`npm run build` 時に生成される
 * gitignore 済みの src/env.local.ts（グローバル定数 ENV）から読み込む。
 * → コミット対象のソースには秘密情報が一切残らない。
 */
function initProperties(): void {
  const store = PropertiesService.getScriptProperties();
  const keys = Object.keys(ENV);
  keys.forEach((k) => {
    if (ENV[k] !== "") store.setProperty(k, ENV[k]);
  });
  Logger.log(`Script Properties を更新しました (${keys.length} 件)`);
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

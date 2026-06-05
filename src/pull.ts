/**
 * Cloud Pub/Sub の pull 購読からメッセージを取得して処理する。
 * 時間トリガー（1分毎）で pollPubsub() を回す。
 *
 * push を使わない理由: GAS Web App の /exec は 302 リダイレクトを返すため
 * Pub/Sub push のエンドポイントにできない（2xx を返せず無限再送になる）。
 *
 * 認可: GAS 実行ユーザー（= GCP プロジェクト所有者）の OAuth トークンで
 *       Pub/Sub API を直接叩く（scope: .../auth/pubsub）。
 */

const PUBSUB_API = "https://pubsub.googleapis.com/v1";

/** pull 購読からメッセージを取得し、処理して ack する。トリガーから1分毎に実行。 */
function pollPubsub(): void {
  const sub = Config.pubsubSubscriptionPath();
  const token = ScriptApp.getOAuthToken();

  const pullResp = UrlFetchApp.fetch(`${PUBSUB_API}/${sub}:pull`, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({ maxMessages: 100 }),
    muteHttpExceptions: true,
  });

  if (pullResp.getResponseCode() !== 200) {
    Logger.log(`pull 失敗: ${pullResp.getResponseCode()} ${pullResp.getContentText()}`);
    return;
  }

  const body = JSON.parse(pullResp.getContentText());
  const received: any[] = body.receivedMessages || [];
  if (received.length === 0) return;

  const ackIds: string[] = [];
  for (const rm of received) {
    try {
      handlePubsubMessage(rm.message);
    } catch (e) {
      Logger.log(`メッセージ処理エラー: ${e}`);
      // 処理に失敗したものは ack しない → 次回再配信される
      continue;
    }
    if (rm.ackId) ackIds.push(rm.ackId);
  }

  if (ackIds.length > 0) {
    const ackResp = UrlFetchApp.fetch(`${PUBSUB_API}/${sub}:acknowledge`, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ ackIds: ackIds }),
      muteHttpExceptions: true,
    });
    if (ackResp.getResponseCode() < 200 || ackResp.getResponseCode() >= 300) {
      Logger.log(`ack 失敗: ${ackResp.getContentText()}`);
    }
  }
  Logger.log(`処理 ${received.length} 件 / ack ${ackIds.length} 件`);
}

/** pollPubsub の1分毎トリガーを登録する。一度だけ実行。 */
function installPollTrigger(): void {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "pollPubsub")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("pollPubsub").timeBased().everyMinutes(1).create();
  Logger.log("pollPubsub の1分毎トリガーを登録しました");
}

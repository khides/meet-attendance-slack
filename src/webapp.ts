/**
 * Web App エントリポイント。
 *
 * - doPost : Cloud Pub/Sub の push 購読からイベントを受け取り Slack へ投稿する。
 * - doGet  : OAuth(方式A) の認可コールバック / 簡易ヘルスチェック。
 *
 * Pub/Sub push の本文:
 *   { "message": { "data": <base64>, "attributes": {...}, "messageId": ... },
 *     "subscription": "projects/.../subscriptions/..." }
 *
 * Workspace Events API は CloudEvent を Pub/Sub へ発行する。
 *   - attributes["ce-type"] : イベント種別 (participant.joined / left)
 *   - attributes["ce-time"] : 発生時刻 (RFC3339)
 *   - data (base64 JSON)     : includeResource=true なら participant リソースを含む
 */

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    if (!verifyPubsubRequest(e)) {
      return textOutput("unauthorized", 401);
    }

    const envelope = JSON.parse(e.postData.contents);
    const message = envelope.message;
    if (!message) return textOutput("no message", 204);

    const attributes = message.attributes || {};
    const eventType: string = attributes["ce-type"] || "";
    const whenIso: string = attributes["ce-time"] || "";

    // participant 系イベントのみ処理
    if (eventType.indexOf("meet.participant") === -1) {
      return textOutput("ignored", 204);
    }

    const dataJson = message.data
      ? Utilities.newBlob(Utilities.base64Decode(message.data)).getDataAsString()
      : "{}";
    const payload = JSON.parse(dataJson);

    const participantResource = payload.participant || (payload.resource && payload.resource.participant);
    const participantName: string = participantResource ? participantResource.name : "";

    // 監視対象の会議コードでフィルタ（空なら全会議を通す）
    const targets = Config.targetMeetingCodes();
    let meetingCode = "";
    if (participantName && (targets.length > 0)) {
      meetingCode = resolveMeetingCode(participantName, firstHost());
      const norms = targets.map(normMeetingCode);
      if (!meetingCode || norms.indexOf(normMeetingCode(meetingCode)) === -1) {
        return textOutput("filtered (not a target meeting)", 204);
      }
    }

    // 表示用ラベル: 会議コードが分かればそれを、無ければ conferenceRecord 名など
    const contextLabel = meetingCode
      ? `meet.google.com/${meetingCode}`
      : deriveContext(participantName, attributes);

    // 表示名解決 (includeResource があれば追加API無しで解決)
    const info = resolveParticipant(participantName, participantResource, firstHost());

    postToSlack(formatAttendanceMessage(eventType, info, contextLabel, whenIso));
    return textOutput("ok", 200);
  } catch (err) {
    Logger.log(`doPost エラー: ${err}\n${(err as Error).stack || ""}`);
    // GAS Web App は任意のHTTPステータスを返せない。正常終了すると常に200=ack となり
    // メッセージが破棄されるため、再送させたい一時障害は例外を再スローして 5xx を返す。
    // (Pub/Sub のリトライで二重投稿が起き得るので Slack 文面の冪等性は許容する)
    throw err;
  }
}

function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  // OAuth コールバック (code パラメータ付き) なら認可処理へ
  if (e.parameter && (e.parameter["code"] || e.parameter["error"])) {
    return authCallback(e);
  }
  return HtmlService.createHtmlOutput("meet-attendance-slack: OK");
}

/** Pub/Sub push の OIDC トークンを検証する (PUBSUB_AUDIENCE 設定時のみ)。 */
function verifyPubsubRequest(e: GoogleAppsScript.Events.DoPost): boolean {
  const audience = Config.pubsubAudience();
  if (!audience) return true; // 検証無効 (開発時のみ推奨)

  // GAS の doPost では Authorization ヘッダを直接取得できないため、
  // Pub/Sub push 購読に "?token=<秘密>" を付けて検証する運用にする。
  // 例: pushEndpoint = https://script.google.com/.../exec?token=XXXX
  const expected = PropertiesService.getScriptProperties().getProperty("PUSH_SHARED_TOKEN");
  if (!expected) return true;
  const got = e.parameter ? e.parameter["token"] : "";
  return got === expected;
}

function deriveContext(participantName: string, attributes: any): string {
  // "conferenceRecords/{cr}/participants/{p}" から会議IDを抜く
  const m = /^conferenceRecords\/([^/]+)/.exec(participantName || "");
  if (m) return `会議 ${m[1]}`;
  if (attributes && attributes["ce-source"]) return attributes["ce-source"];
  return "Meet";
}

/** 表示名の追加解決が必要なときに使う代表ホスト (通常は inlineResource で不要)。 */
function firstHost(): string {
  const hosts = Config.hosts();
  return hosts.length > 0 ? hosts[0] : "";
}

function textOutput(body: string, _status: number): GoogleAppsScript.Content.TextOutput {
  // GAS Web App は HTTP ステータスを自由設定できないが、Pub/Sub は 2xx を ack とみなす。
  // エラー時に再送させたい場合は例外を投げる方が確実。
  return ContentService.createTextOutput(body);
}

/**
 * Slack Incoming Webhook への投稿。
 */

function postToSlack(text: string): void {
  const resp = UrlFetchApp.fetch(Config.slackWebhookUrl(), {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`Slack 投稿失敗: ${resp.getResponseCode()} ${resp.getContentText()}`);
  }
}

/** 入退室を見やすい文面に整形する。 */
function formatAttendanceMessage(
  eventType: string,
  participant: ParticipantInfo,
  context: string,
  whenIso: string
): string {
  const joined = eventType.endsWith("joined");
  const emoji = joined ? ":inbox_tray:" : ":outbox_tray:";
  const verb = joined ? "入室" : "退室";
  const time = formatJst(whenIso);
  return `${emoji} *${participant.displayName}* さんが${verb}しました（${context} / ${time}）`;
}

function formatJst(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  } catch (e) {
    return iso;
  }
}

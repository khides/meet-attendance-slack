/**
 * Slack Incoming Webhook への投稿。
 */

function postToSlack(text: string, webhookUrl?: string): void {
  const resp = UrlFetchApp.fetch(webhookUrl || Config.slackWebhookUrl(), {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`Slack 投稿失敗: ${resp.getResponseCode()} ${resp.getContentText()}`);
  }
}

/** 入退室を見やすい文面に整形する。
 *  入室=🟢（緑丸） / 退室=🔺（赤三角）で一目で区別。
 *  headcount >= 0 のとき「現在 N名」を付与（不明なら省略）。 */
function formatAttendanceMessage(
  eventType: string,
  participant: ParticipantInfo,
  context: string,
  whenIso: string,
  headcount: number
): string {
  const joined = eventType.endsWith("joined");
  const emoji = joined ? ":large_green_circle:" : ":small_red_triangle:";
  const verb = joined ? "入室" : "退室";
  const time = formatJst(whenIso);
  const countPart =
    headcount >= 0 ? ` ｜ :busts_in_silhouette: 現在 ${headcount}名` : "";
  return `${emoji} *${participant.displayName}* さんが${verb}しました${countPart}（${context} / ${time}）`;
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

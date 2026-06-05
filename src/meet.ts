/**
 * Meet REST API 呼び出し。
 * 入退室イベントの payload には participant のリソース名が入るので、
 * 必要に応じて参加者名・会議情報を解決する。
 */

const MEET_API = "https://meet.googleapis.com/v2";

interface ParticipantInfo {
  displayName: string;
  /** "signed_in" | "anonymous" | "phone" */
  kind: string;
}

/**
 * participant リソース (例:
 *   "conferenceRecords/abc/participants/xyz")
 * から表示名を解決する。payload に既に含まれていればそれを優先。
 */
function resolveParticipant(
  participantResourceName: string,
  inlineResource: any,
  userEmail: string
): ParticipantInfo {
  const res = inlineResource || fetchParticipant(participantResourceName, userEmail);
  if (res && res.signedinUser) {
    return { displayName: res.signedinUser.displayName || "(不明)", kind: "signed_in" };
  }
  if (res && res.anonymousUser) {
    return { displayName: res.anonymousUser.displayName || "ゲスト", kind: "anonymous" };
  }
  if (res && res.phoneUser) {
    return { displayName: res.phoneUser.displayName || "電話参加者", kind: "phone" };
  }
  return { displayName: "(不明な参加者)", kind: "unknown" };
}

function fetchParticipant(resourceName: string, userEmail: string): any {
  const token = getAccessTokenFor(userEmail);
  const resp = UrlFetchApp.fetch(`${MEET_API}/${resourceName}`, {
    method: "get",
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`participant 取得失敗 (${resourceName}): ${resp.getContentText()}`);
    return null;
  }
  return JSON.parse(resp.getContentText());
}

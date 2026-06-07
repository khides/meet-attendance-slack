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

/**
 * スペースのリソース名（spaces/{id}）から会議コード
 * （meet.google.com/【code】 の部分）を解決する。space 単位でキャッシュ。
 */
function resolveMeetingCodeForSpace(spaceName: string, userEmail: string): string {
  if (!spaceName) return "";
  const cache = CacheService.getScriptCache();
  const cacheKey = `scode2_${spaceName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached; // 成功値のみキャッシュ利用（空は無視して再取得）

  const token = getAccessTokenFor(userEmail);
  const space = meetGet(spaceName, token);
  let code = "";
  if (space) {
    if (space.meetingUri) {
      code = String(space.meetingUri).split("/").pop() || "";
    } else if (space.meetingCode) {
      code = String(space.meetingCode);
    }
  }
  // 失敗(空)はキャッシュしない。成功時のみ1時間キャッシュ。
  if (code) cache.put(cacheKey, code, 3600);
  return code;
}

/**
 * 会議コード（例: aaa-bbbb-ccc）から Meet スペースのリソース名（spaces/{id}）を解決する。
 * Meet API の spaces.get は会議コードをエイリアスとして受け付ける。
 * 認可ユーザー（主催者）がそのスペースにアクセスできる必要がある。
 */
function resolveSpaceName(meetingCode: string, userEmail: string): string {
  const token = getAccessTokenFor(userEmail);
  const space = meetGet(`spaces/${meetingCode}`, token);
  return space && space.name ? space.name : "";
}

function meetGet(resourceName: string, token: string): any {
  const resp = UrlFetchApp.fetch(`${MEET_API}/${resourceName}`, {
    method: "get",
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log(`Meet GET 失敗 (${resourceName}): ${resp.getContentText()}`);
    return null;
  }
  return JSON.parse(resp.getContentText());
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

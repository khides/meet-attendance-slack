/**
 * Pub/Sub メッセージ（CloudEvent）1件を処理して Slack に投稿する共通ロジック。
 * push / pull どちらの経路でも使えるよう、message オブジェクトを受け取る形にする。
 *
 * Pub/Sub message:
 *   { data: <base64 JSON>, attributes: {...}, messageId: "..." }
 * Workspace Events の CloudEvent 属性:
 *   attributes["ce-type"] : 種別 (….participant.v2.joined / .left)
 *   attributes["ce-time"] : 発生時刻 (RFC3339)
 *   attributes["ce-source"]: 発生元 (購読/スペース)
 */

/** メッセージを処理。重複(messageId)はスキップ。投稿したら true。 */
function handlePubsubMessage(message: any): void {
  if (!message) return;

  // 重複排除（pull の再配信や ack 失敗時の二重投稿を防ぐ）
  const messageId: string = message.messageId || message.message_id || "";
  if (messageId && isAlreadyProcessed(messageId)) return;

  const attributes = message.attributes || {};
  const eventType: string = attributes["ce-type"] || "";
  Logger.log(`[event] type=${eventType} msgId=${messageId}`);

  // participant 系イベントのみ対象
  if (eventType.indexOf("meet.participant") === -1) {
    Logger.log(`[skip] participant 以外のイベント: ${eventType}`);
    if (messageId) markProcessed(messageId);
    return;
  }

  const whenIso: string = attributes["ce-time"] || "";
  const dataJson = message.data
    ? Utilities.newBlob(Utilities.base64Decode(message.data)).getDataAsString()
    : "{}";
  const payload = JSON.parse(dataJson);

  const participantName = extractParticipantName(payload);

  // スペースは ce-subject 属性から直接得られる（//meet.googleapis.com/spaces/{id}）
  const spaceName = spaceFromSubject(attributes);
  let meetingCode = "";
  if (spaceName) {
    meetingCode = resolveMeetingCodeForSpace(spaceName, firstHost());
  }
  Logger.log(`[event] space=${spaceName} meetingCode=${meetingCode} participant=${participantName}`);

  // 監視対象の会議コードでフィルタ（空なら全会議を通す）
  const targets = Config.targetMeetingCodes();
  if (targets.length > 0) {
    const norms = targets.map(normMeetingCode);
    if (!meetingCode || norms.indexOf(normMeetingCode(meetingCode)) === -1) {
      Logger.log(`[skip] 対象外の会議: meetingCode=${meetingCode} targets=${targets.join(",")}`);
      if (messageId) markProcessed(messageId); // 対象外。再処理不要
      return;
    }
  }

  const contextLabel = meetingCode
    ? `meet.google.com/${meetingCode}`
    : deriveContext(participantName, attributes);

  const info = resolveParticipant(participantName, null, firstHost());
  Logger.log(`[post] name=${info.displayName} kind=${info.kind} ${eventType}`);

  postToSlack(formatAttendanceMessage(eventType, info, contextLabel, whenIso));
  if (messageId) markProcessed(messageId);
}

/**
 * payload から participant のリソース名（conferenceRecords/{cr}/participants/{p}）を取り出す。
 * 実データ:
 *   { "participantSession": { "name":
 *       "conferenceRecords/{cr}/participants/{pid}/participantSessions/{sid}" } }
 * participantSession 名から participant リソースまでに切り詰める（表示名解決に使う）。
 */
function extractParticipantName(payload: any): string {
  let raw = "";
  if (payload) {
    if (payload.participantSession && typeof payload.participantSession.name === "string") {
      raw = payload.participantSession.name;
    } else if (payload.participant && typeof payload.participant.name === "string") {
      raw = payload.participant.name;
    } else if (typeof payload.participant === "string") {
      raw = payload.participant;
    } else if (typeof payload.name === "string") {
      raw = payload.name;
    } else {
      raw = findParticipantPath(payload, 0);
    }
  }
  const m = /^(conferenceRecords\/[^/]+\/participants\/[^/]+)/.exec(raw);
  return m ? m[1] : raw;
}

function findParticipantPath(obj: any, depth: number): string {
  if (obj == null || depth > 4) return "";
  if (typeof obj === "string") {
    return /conferenceRecords\/[^/]+\/participants\//.test(obj) ? obj : "";
  }
  if (typeof obj === "object") {
    for (const k in obj) {
      const r = findParticipantPath(obj[k], depth + 1);
      if (r) return r;
    }
  }
  return "";
}

/** ce-subject 属性からスペースのリソース名（spaces/{id}）を取り出す。 */
function spaceFromSubject(attributes: any): string {
  const subj: string = (attributes && attributes["ce-subject"]) || "";
  const m = /(spaces\/[^/]+)\/?$/.exec(subj);
  return m ? m[1] : "";
}

function deriveContext(participantName: string, attributes: any): string {
  const m = /^conferenceRecords\/([^/]+)/.exec(participantName || "");
  if (m) return `会議 ${m[1]}`;
  if (attributes && attributes["ce-source"]) return attributes["ce-source"];
  return "Meet";
}

/** 表示名の解決に使う代表ホスト。 */
function firstHost(): string {
  const hosts = Config.hosts();
  return hosts.length > 0 ? hosts[0] : "";
}

// --- 重複排除（CacheService、6時間）---
function isAlreadyProcessed(messageId: string): boolean {
  return CacheService.getScriptCache().get(`msg_${messageId}`) !== null;
}
function markProcessed(messageId: string): void {
  CacheService.getScriptCache().put(`msg_${messageId}`, "1", 21600);
}

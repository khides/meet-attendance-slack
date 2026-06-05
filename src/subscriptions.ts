/**
 * Google Workspace Events API の購読 (subscription) 管理。
 *
 * 各主催者を「ユーザー単位 target」で購読する。これにより、その主催者が
 * オーナーである全 Meet スペースの入退室イベントを自動でカバーできる
 * (特定の会議コードを毎回解決する必要がない)。
 *
 * 購読には TTL があるため、時間トリガーで renewAllSubscriptions() を回す。
 */

const WORKSPACE_EVENTS_API = "https://workspaceevents.googleapis.com/v1";

/**
 * 購読を作成する。
 * - TARGET_MEETING_CODES があれば「スペース単位」で購読（個人Gmailでも動く）。
 *   会議コードを Meet API でスペースに解決し、そのスペースを購読する。
 * - 空なら「ユーザー単位」で購読（主催者の全会議。Cloud Identity が必要＝Workspace向け）。
 */
function createAllSubscriptions(): void {
  const codes = Config.targetMeetingCodes();
  if (codes.length > 0) {
    const host = Config.hosts()[0]; // スペース所有者（代表ホスト）
    for (const code of codes) {
      try {
        const spaceName = resolveSpaceName(code, host); // "spaces/{id}"
        if (!spaceName) {
          Logger.log(`スペース解決に失敗（会議コード=${code}）。主催者がオーナーか確認してください。`);
          continue;
        }
        createSubscriptionForTarget(`//meet.googleapis.com/${spaceName}`, host);
        Logger.log(`購読を作成(space): ${code} → ${spaceName}`);
      } catch (e) {
        Logger.log(`購読作成に失敗 (会議コード=${code}): ${e}`);
      }
    }
    return;
  }
  // ユーザー単位（Workspace 向け）
  for (const userEmail of Config.hosts()) {
    try {
      createSubscriptionForTarget("//cloudidentity.googleapis.com/users/me", userEmail);
      Logger.log(`購読を作成(user): ${userEmail}`);
    } catch (e) {
      Logger.log(`購読作成に失敗 (${userEmail}): ${e}`);
    }
  }
}

/** 指定 targetResource の購読を、指定ユーザーの権限で作成する。 */
function createSubscriptionForTarget(targetResource: string, userEmail: string): void {
  const token = getAccessTokenFor(userEmail);
  // 注: Meet の購読では payloadOptions.includeResource は非対応のため指定しない。
  // イベントには参加者のリソース名のみ含まれ、表示名は doPost 側で Meet API から解決する。
  const payload = {
    targetResource: targetResource,
    eventTypes: MEET_EVENT_TYPES,
    notificationEndpoint: { pubsubTopic: Config.pubsubTopicPath() },
  };

  const resp = UrlFetchApp.fetch(`${WORKSPACE_EVENTS_API}/subscriptions`, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 409) {
    Logger.log(`購読は既に存在 (${targetResource})`);
    return;
  }
  if (code < 200 || code >= 300) {
    throw new Error(`subscriptions.create 失敗 (${code}): ${resp.getContentText()}`);
  }
}

/** TTL 切れ防止のため、全購読を延長する。時間トリガー(例: 12h毎)で実行。 */
function renewAllSubscriptions(): void {
  for (const userEmail of Config.hosts()) {
    try {
      const subs = listSubscriptionsFor(userEmail);
      if (subs.length === 0) {
        createAllSubscriptions();
        Logger.log(`購読が無かったため作成: ${userEmail}`);
        continue;
      }
      for (const sub of subs) {
        renewSubscription(userEmail, sub.name);
        Logger.log(`購読を延長: ${userEmail} (${sub.name})`);
      }
    } catch (e) {
      Logger.log(`購読更新に失敗 (${userEmail}): ${e}`);
    }
  }
}

/** 主催者の購読一覧 (この trigger の Meet 購読のみ) を返す。 */
function listSubscriptionsFor(userEmail: string): { name: string }[] {
  const token = getAccessTokenFor(userEmail);
  const filter = encodeURIComponent(
    'event_types:"google.workspace.meet.participant.v2.joined"'
  );
  const resp = UrlFetchApp.fetch(
    `${WORKSPACE_EVENTS_API}/subscriptions?filter=${filter}`,
    {
      method: "get",
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() !== 200) {
    throw new Error(`subscriptions.list 失敗: ${resp.getContentText()}`);
  }
  const body = JSON.parse(resp.getContentText());
  return (body.subscriptions || []) as { name: string }[];
}

/** ttl を空更新して有効期限を延長する (patch with updateMask=ttl)。 */
function renewSubscription(userEmail: string, subscriptionName: string): void {
  const token = getAccessTokenFor(userEmail);
  const resp = UrlFetchApp.fetch(
    `${WORKSPACE_EVENTS_API}/${subscriptionName}?updateMask=ttl`,
    {
      method: "patch",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      // ttl を空にすると API 既定の最大有効期限へ延長される
      payload: JSON.stringify({ ttl: { seconds: 0 } }),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    throw new Error(`subscriptions.patch 失敗: ${resp.getContentText()}`);
  }
}

/** 全主催者の購読を削除する (クリーンアップ用)。 */
function deleteAllSubscriptions(): void {
  for (const userEmail of Config.hosts()) {
    try {
      const token = getAccessTokenFor(userEmail);
      for (const sub of listSubscriptionsFor(userEmail)) {
        UrlFetchApp.fetch(`${WORKSPACE_EVENTS_API}/${sub.name}`, {
          method: "delete",
          headers: { Authorization: `Bearer ${token}` },
          muteHttpExceptions: true,
        });
        Logger.log(`購読を削除: ${sub.name}`);
      }
    } catch (e) {
      Logger.log(`購読削除に失敗 (${userEmail}): ${e}`);
    }
  }
}

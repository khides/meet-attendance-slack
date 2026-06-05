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

/** 全主催者ぶんの購読を作成 (既存があれば作り直し)。手動 or 初期化で実行。 */
function createAllSubscriptions(): void {
  for (const userEmail of Config.hosts()) {
    try {
      createSubscriptionFor(userEmail);
      Logger.log(`購読を作成: ${userEmail}`);
    } catch (e) {
      Logger.log(`購読作成に失敗 (${userEmail}): ${e}`);
    }
  }
}

/** 指定主催者のユーザー単位購読を作成する。 */
function createSubscriptionFor(userEmail: string): void {
  const token = getAccessTokenFor(userEmail);
  const payload = {
    targetResource: "//cloudidentity.googleapis.com/users/me",
    eventTypes: MEET_EVENT_TYPES,
    payloadOptions: { includeResource: true },
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
    // 既に同等の購読がある。renew に任せる。
    Logger.log(`購読は既に存在 (${userEmail})`);
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
        createSubscriptionFor(userEmail);
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

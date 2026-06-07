/**
 * 方式B: サービスアカウント + ドメイン全体委任 (Workspace のみ)。【キーレス】
 *
 * 管理コンソールで一度だけ「ドメイン全体の委任」に SA のクライアントIDと
 * MEET_SCOPE を登録すれば、組織内の任意の主催者を "なりすまし" (sub) して
 * トークンを取得できる。主催者個別の同意は不要。
 *
 * SA の秘密鍵はダウンロードしない（組織ポリシー
 * constraints/iam.disableServiceAccountKeyCreation を順守）。
 * 代わりに IAM Credentials API の signJwt を使い、GAS 実行ユーザーの権限
 * （SA に対する roles/iam.serviceAccountTokenCreator）で JWT に署名させる。
 *
 *   1. claim（iss=SA, sub=主催者, scope=MEET_SCOPE）を作る
 *   2. iamcredentials.signJwt で SA に署名させる（鍵不要）
 *   3. 署名済み JWT を OAuth トークンエンドポイントで access_token に交換
 *
 * 取得したトークンは 1 時間有効なので CacheService に短期キャッシュする。
 *
 * 必要なもの:
 *   - SA_CLIENT_EMAIL: なりすまし元 SA のメール（meet-dwd@...）
 *   - GAS 実行ユーザーが SA の Token Creator であること
 *   - appsscript.json の oauthScopes に cloud-platform（signJwt 用）
 */

const IAM_CREDENTIALS_API = "https://iamcredentials.googleapis.com/v1";

function dwdGetAccessToken(userEmail: string): string {
  const cache = CacheService.getScriptCache();
  const cacheKey = `dwd_token_${userEmail}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const saEmail = Config.saClientEmail();
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: saEmail,
    sub: userEmail, // ← なりすまし対象 (主催者)
    scope: MEET_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // 1+2. IAM Credentials に SA として JWT 署名を依頼（鍵レス）
  const signResp = UrlFetchApp.fetch(
    `${IAM_CREDENTIALS_API}/projects/-/serviceAccounts/${encodeURIComponent(
      saEmail
    )}:signJwt`,
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      payload: JSON.stringify({ payload: JSON.stringify(claim) }),
      muteHttpExceptions: true,
    }
  );
  if (signResp.getResponseCode() !== 200) {
    throw new Error(
      `signJwt 失敗 (${userEmail}): ${signResp.getContentText()}\n` +
        `→ 実行ユーザーが ${saEmail} の roles/iam.serviceAccountTokenCreator を持ち、` +
        `cloud-platform スコープを承認済みか確認してください。`
    );
  }
  const assertion = JSON.parse(signResp.getContentText()).signedJwt;

  // 3. 署名済み JWT を access_token に交換（DWD: sub の主催者として）
  const resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: assertion,
    },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200 || !body.access_token) {
    throw new Error(
      `DWD トークン取得失敗 (${userEmail}): ${resp.getContentText()}\n` +
        `→ 管理コンソールのドメイン全体の委任に SA のクライアントIDと ${MEET_SCOPE} を登録済みか確認してください。`
    );
  }

  // exp より少し短くキャッシュ
  cache.put(cacheKey, body.access_token, Math.max(60, (body.expires_in || 3600) - 120));
  return body.access_token;
}

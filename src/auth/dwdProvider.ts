/**
 * 方式B: サービスアカウント + ドメイン全体委任 (Workspace のみ)。
 *
 * 管理コンソールで一度だけ「ドメイン全体の委任」に SA のクライアントIDと
 * MEET_SCOPE を登録すれば、組織内の任意の主催者を "なりすまし" (sub) して
 * トークンを取得できる。主催者個別の同意は不要。
 *
 * GAS だけで JWT を自己生成 → トークンエンドポイントへ交換する。
 * 取得したトークンは 1 時間有効なので CacheService に短期キャッシュする。
 */

function dwdGetAccessToken(userEmail: string): string {
  const cache = CacheService.getScriptCache();
  const cacheKey = `dwd_token_${userEmail}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: Config.saClientEmail(),
    sub: userEmail, // ← なりすまし対象 (主催者)
    scope: MEET_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const toSign =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(claim));
  const signatureBytes = Utilities.computeRsaSha256Signature(
    toSign,
    Config.saPrivateKey()
  );
  const assertion = toSign + "." + base64UrlEncodeBytes(signatureBytes);

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
      `DWD トークン取得失敗 (${userEmail}): ${resp.getContentText()}`
    );
  }

  // exp より少し短くキャッシュ
  cache.put(cacheKey, body.access_token, Math.max(60, (body.expires_in || 3600) - 120));
  return body.access_token;
}

function base64UrlEncode(s: string): string {
  return base64UrlEncodeBytes(Utilities.newBlob(s).getBytes());
}

function base64UrlEncodeBytes(bytes: number[]): string {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

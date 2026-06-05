/**
 * 認可の共通インターフェース。
 * 上位ロジック (subscriptions / meet) は「主催者 userEmail として動くトークン」だけを
 * 要求し、その取得方法 (OAuth か DWD か) を意識しない。
 *
 * AUTH_MODE に応じて oauthProvider / dwdProvider のどちらかへ委譲する。
 */

/**
 * 指定した主催者として Google API を呼ぶためのアクセストークンを返す。
 * @param userEmail 主催者のメールアドレス
 */
function getAccessTokenFor(userEmail: string): string {
  switch (Config.authMode()) {
    case "oauth":
      return oauthGetAccessToken(userEmail);
    case "dwd":
      return dwdGetAccessToken(userEmail);
    default:
      throw new Error(`未知の AUTH_MODE: ${Config.authMode()}`);
  }
}

/**
 * 全主催者が認可済みか確認し、未認可ならその認可 URL を返す。
 * OAuth モードのみ意味を持つ (DWD は管理者が一括許可済みのため常に空)。
 */
function pendingAuthorizations(): { userEmail: string; authUrl: string }[] {
  if (Config.authMode() !== "oauth") return [];
  const pending: { userEmail: string; authUrl: string }[] = [];
  for (const userEmail of Config.hosts()) {
    const url = oauthAuthorizationUrlIfNeeded(userEmail);
    if (url) pending.push({ userEmail, authUrl: url });
  }
  return pending;
}

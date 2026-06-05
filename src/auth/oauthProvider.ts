/**
 * 方式A: 主催者本人の OAuth 同意 (個人Gmail / 組織外OK)。
 *
 * apps-script-oauth2 (ライブラリ "OAuth2") を使い、主催者ごとに refresh token を
 * Script Properties (キー prefix "oauth2.<email>") へ保存する。
 *
 * 主催者は一度だけ getAuthorizationUrl() を開いて同意する必要がある。
 * 認可後のコールバックは Web App の doGet (= authCallback) で受ける。
 */

declare const OAuth2: any;

function getOAuthService(userEmail: string): any {
  return OAuth2.createService(`meet:${userEmail}`)
    .setAuthorizationBaseUrl("https://accounts.google.com/o/oauth2/v2/auth")
    .setTokenUrl("https://oauth2.googleapis.com/token")
    .setClientId(Config.oauthClientId())
    .setClientSecret(Config.oauthClientSecret())
    .setCallbackFunction("authCallback")
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setScope(`${MEET_SCOPE} https://www.googleapis.com/auth/userinfo.email`)
    .setParam("access_type", "offline")
    .setParam("prompt", "consent")
    .setParam("login_hint", userEmail);
}

/** 主催者として呼べるアクセストークンを返す (未認可なら例外)。 */
function oauthGetAccessToken(userEmail: string): string {
  const service = getOAuthService(userEmail);
  if (!service.hasAccess()) {
    throw new Error(
      `主催者 ${userEmail} が未認可です。次の URL で同意してください: ${service.getAuthorizationUrl()}`
    );
  }
  return service.getAccessToken();
}

/** 未認可なら認可 URL を、認可済みなら null を返す。 */
function oauthAuthorizationUrlIfNeeded(userEmail: string): string | null {
  const service = getOAuthService(userEmail);
  return service.hasAccess() ? null : service.getAuthorizationUrl();
}

/**
 * OAuth 認可コールバック。
 * Web App としてデプロイ後、各主催者がブラウザで同意するとここに戻る。
 * state に email を載せ、サービス名を復元してトークンを保存する。
 */
function authCallback(request: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  // apps-script-oauth2 は state にサービス名 (meet:<email>) を保持している
  const serviceName: string = request.parameter["serviceName"] || "";
  const userEmail = serviceName.replace(/^meet:/, "");
  const service = getOAuthService(userEmail);
  const authorized = service.handleCallback(request);
  const msg = authorized
    ? `認可に成功しました (${userEmail})。このタブは閉じてかまいません。`
    : "認可が拒否されました。";
  return HtmlService.createHtmlOutput(msg);
}

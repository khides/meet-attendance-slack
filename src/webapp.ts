/**
 * Web App エントリポイント。
 *
 * 役割は OAuth(方式A) の認可コールバック受けのみ。
 * イベント配信は Pub/Sub の「pull」方式（pull.ts / events.ts）で受け取る。
 *
 * 注: GAS Web App の /exec は内部で 302 リダイレクトを返すため、
 *     Cloud Pub/Sub の「push」先には使えない（2xx を返せず無限再送になる）。
 *     そのため push ではなく pull を採用している。
 */

function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  // OAuth コールバック (code パラメータ付き) なら認可処理へ
  if (e.parameter && (e.parameter["code"] || e.parameter["error"])) {
    return authCallback(e);
  }
  return HtmlService.createHtmlOutput("meet-attendance-slack: OK");
}

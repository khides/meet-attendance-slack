#!/usr/bin/env node
/**
 * service-account.json の内容を .env へ注入する。
 * gcp-setup.sh の DWD ブランチから呼ばれる。
 *
 * - SA_CLIENT_EMAIL: service account の client_email
 * - SA_PRIVATE_KEY : 改行を \n エスケープして1行化した private_key
 *
 * .env に既存エントリ（コメントアウト含む）があれば上書き、なければ末尾に追記。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const saPath = resolve(root, "service-account.json");
const envPath = resolve(root, ".env");

if (!existsSync(saPath)) {
  console.error("service-account.json が見つかりません");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(saPath, "utf8"));
const clientEmail = sa.client_email || "";
const privateKey = (sa.private_key || "").replace(/\r/g, "").replace(/\n/g, "\\n");

if (!clientEmail || !privateKey) {
  console.error("service-account.json に client_email / private_key がありません");
  process.exit(1);
}

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

/** キーが存在すれば（コメント含む）置換、なければ末尾追記 */
function setKey(text, key, value) {
  const re = new RegExp(`^#?\\s*${key}=.*`, "m");
  return re.test(text)
    ? text.replace(re, `${key}=${value}`)
    : text.endsWith("\n")
    ? text + `${key}=${value}\n`
    : text + `\n${key}=${value}\n`;
}

env = setKey(env, "SA_CLIENT_EMAIL", clientEmail);
env = setKey(env, "SA_PRIVATE_KEY", privateKey);

writeFileSync(envPath, env);
console.log(`SA_CLIENT_EMAIL=${clientEmail}`);
console.log("SA_PRIVATE_KEY=<written>");

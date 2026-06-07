#!/usr/bin/env node
/**
 * .env のキーを upsert する。
 *   node scripts/set-env.mjs KEY=VALUE [KEY2=VALUE2 ...]
 * 既存エントリ（コメントアウト含む）があれば置換、なければ末尾に追記。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

function setKey(text, key, value) {
  const re = new RegExp(`^#?\\s*${key}=.*`, "m");
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  return (text.endsWith("\n") || text === "" ? text : text + "\n") + `${key}=${value}\n`;
}

for (const pair of process.argv.slice(2)) {
  const eq = pair.indexOf("=");
  if (eq === -1) continue;
  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  env = setKey(env, key, value);
  console.log(`${key}=${value}`);
}

writeFileSync(envPath, env);

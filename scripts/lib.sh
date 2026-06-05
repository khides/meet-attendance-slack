#!/usr/bin/env bash
# 共通ヘルパー。各スクリプトの先頭で source する。
set -euo pipefail

# リポジトリルートへ移動
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- 表示 ---
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BOLD=""
fi
info() { printf "%s\n" "${C_BLUE}▶ ${*}${C_RESET}"; }
ok()   { printf "%s\n" "${C_GREEN}✔ ${*}${C_RESET}"; }
warn() { printf "%s\n" "${C_YELLOW}⚠ ${*}${C_RESET}"; }
err()  { printf "%s\n" "${C_RED}x ${*}${C_RESET}" >&2; }
step() { printf "\n%s\n" "${C_BOLD}== ${*} ==${C_RESET}"; }

# --- .env 読み込み（KEY=VALUE、行末コメント/クォートを除去）---
# gen-env.mjs と同じ規則:
#   ・値がクォートで始まらなければ ' #' 以降を行末コメントとして除去
#   ・前後の空白と囲みクォートを除去
load_env() {
  [ -f .env ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    [ "${line%%=*}" = "$line" ] && continue
    local key="${line%%=*}" val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"   # 左トリム
    key="${key%"${key##*[![:space:]]}"}"   # 右トリム
    val="${val#"${val%%[![:space:]]*}"}"   # 値の先頭空白を除去
    # クォートで始まらなければ行末コメント ' #' を除去
    case "$val" in
      \"*|\'*) : ;;
      *" #"*) val="${val%% #*}" ;;
    esac
    val="${val#"${val%%[![:space:]]*}"}"   # 前後の空白を除去
    val="${val%"${val##*[![:space:]]}"}"
    case "$val" in                          # 囲みクォートを外す
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    export "$key=$val"
  done < .env
}

# 同名の Apps Script プロジェクトの scriptId を返す（clasp list を検索）。無ければ空。
# clasp list は長い名前を … で切り詰めるため、前方一致でも判定する。
find_script_by_title() {
  local title="$1"
  npx clasp list 2>/dev/null | node -e '
    const title = process.argv[1];
    const data = require("fs").readFileSync(0, "utf8");
    for (const line of data.split(/\r?\n/)) {
      const m = line.match(/script\.google\.com\/d\/([A-Za-z0-9_-]+)/);
      if (!m) continue;
      // URL より前を名前とみなし、末尾の protocol/区切り（空白/ダッシュ/…）を除去
      let name = line.slice(0, m.index)
        .replace(/https?:\/\/$/, "")
        .replace(/[\s–—\-]+$/, "")
        .replace(/[….]+$/, "")
        .trim();
      if (name === title || (name.length >= 10 && title.startsWith(name))) {
        process.stdout.write(m[1]);
        process.exit(0);
      }
    }
  ' "$title" 2>/dev/null || true
}

require_cmd() {
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || { err "コマンド '$c' が見つかりません"; return 1; }
  done
}

require_env() {
  local missing=0
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then err ".env に $v がありません"; missing=1; fi
  done
  [ "$missing" -eq 0 ] || { err ".env を確認してください（cp .env.example .env）"; return 1; }
}

# ブラウザ必須など手動ステップの一時停止
pause() {
  printf "%s" "${C_YELLOW}↵ 完了したら Enter を押してください…${C_RESET}"
  read -r _
}

# scriptId を .clasp.json から取得（失敗時は空文字を返す・常に exit 0）
script_id() {
  node -e "
    try {
      var c = require('./.clasp.json');
      process.stdout.write(c.scriptId || c.scriptID || '');
    } catch(e) {}
  " 2>/dev/null || true
}

load_env

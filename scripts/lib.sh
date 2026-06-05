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

# --- .env 読み込み（KEY=VALUE のみ、コメント無視）---
load_env() {
  [ -f .env ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    [ "${line%%=*}" = "$line" ] && continue
    local key="${line%%=*}" val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"   # 右トリム
    export "$key=$val"
  done < .env
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

# scriptId を .clasp.json から取得
script_id() {
  node -e "process.stdout.write(require('./.clasp.json').scriptId||'')" 2>/dev/null
}

load_env

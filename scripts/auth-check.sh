#!/usr/bin/env bash
# clasp / gcloud のログイン状態を確認し、未ログインなら案内する。
source "$(dirname "$0")/lib.sh"

step "認証チェック"

# clasp
if [ -f "$HOME/.clasprc.json" ]; then
  ok "clasp: ログイン済み"
else
  warn "clasp: 未ログイン。次を実行してください（主催者の個人Gmailで）:"
  echo "    npx clasp login"
fi

# gcloud
if command -v gcloud >/dev/null 2>&1; then
  if gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
    ok "gcloud: ログイン済み（$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)）"
  else
    warn "gcloud: 未ログイン。次を実行してください:"
    echo "    gcloud auth login"
  fi
else
  warn "gcloud: 未インストール。'mise install' で導入されます。"
fi

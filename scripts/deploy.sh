#!/usr/bin/env bash
# build → clasp push → Web App デプロイ → push購読作成（冪等）
source "$(dirname "$0")/lib.sh"

require_cmd npx node
require_env GCP_PROJECT_ID PUBSUB_TOPIC

step "ビルド & push"
npm run build
npx clasp push -f
ok "コードを Apps Script に反映"

step "Web App デプロイ"
# 既存デプロイがあれば再利用、無ければ新規作成
DEPLOY_DESC="meet-attendance-slack web app"
npx clasp deploy --description "$DEPLOY_DESC" >/dev/null
# 最新の versioned デプロイ ID（AKfycb… 形式）を取得
DEPLOY_ID="$(npx clasp deployments 2>/dev/null | grep -oE 'AKfyc[0-9A-Za-z_-]+' | tail -1)"
if [ -z "$DEPLOY_ID" ]; then
  err "デプロイ ID を取得できませんでした。'npx clasp deployments' を確認してください。"
  exit 1
fi
WEBAPP_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"
ok "Web App URL: $WEBAPP_URL"

# push エンドポイント（任意のトークン検証つき）
PUSH_ENDPOINT="$WEBAPP_URL"
if [ -n "${PUSH_SHARED_TOKEN:-}" ]; then
  PUSH_ENDPOINT="${WEBAPP_URL}?token=${PUSH_SHARED_TOKEN}"
fi

step "Pub/Sub push 購読を作成"
require_cmd gcloud
SUB_NAME="${PUBSUB_TOPIC}-push"
if gcloud pubsub subscriptions describe "$SUB_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  info "既存の push 購読を更新…"
  gcloud pubsub subscriptions modify-push-config "$SUB_NAME" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --project "$GCP_PROJECT_ID" >/dev/null
  ok "push 購読を更新（$SUB_NAME）"
else
  gcloud pubsub subscriptions create "$SUB_NAME" \
    --topic="$PUBSUB_TOPIC" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --project "$GCP_PROJECT_ID" >/dev/null
  ok "push 購読を作成（$SUB_NAME）"
fi

# 後続で使えるように URL を保存（gitignore 対象）
printf "%s\n" "$WEBAPP_URL" > .webapp_url
ok "デプロイ完了。WebApp URL を .webapp_url に保存しました。"

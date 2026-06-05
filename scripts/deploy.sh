#!/usr/bin/env bash
# build → clasp push → Web App デプロイ → push購読作成（冪等）
source "$(dirname "$0")/lib.sh"

require_cmd npx node
require_env GCP_PROJECT_ID PUBSUB_TOPIC

step "ビルド & push"
npm run build
npx clasp push -f
ok "コードを Apps Script に反映"

step "Web App デプロイ（OAuth コールバック用）"
# 注: Web App は OAuth(方式A) のコールバック用。Pub/Sub の受信は pull で行う
#     （GAS の /exec は 302 を返すため push 先にできない）。
DEPLOY_DESC="meet-attendance-slack web app"
npx clasp deploy --description "$DEPLOY_DESC" >/dev/null
DEPLOY_ID="$(npx clasp deployments 2>/dev/null | grep -oE 'AKfyc[0-9A-Za-z_-]+' | tail -1)"
if [ -n "$DEPLOY_ID" ]; then
  WEBAPP_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"
  printf "%s\n" "$WEBAPP_URL" > .webapp_url
  ok "Web App URL: $WEBAPP_URL"
fi

step "Pub/Sub pull 購読を作成"
require_cmd gcloud
SUB_NAME="${PUBSUB_SUBSCRIPTION:-${PUBSUB_TOPIC}-pull}"
if gcloud pubsub subscriptions describe "$SUB_NAME" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  ok "pull 購読は既に存在（$SUB_NAME）"
else
  # ack 期限は処理時間に余裕を持たせる
  gcloud pubsub subscriptions create "$SUB_NAME" \
    --topic="$PUBSUB_TOPIC" \
    --ack-deadline=60 \
    --message-retention-duration=1d \
    --project "$GCP_PROJECT_ID" >/dev/null
  ok "pull 購読を作成（$SUB_NAME）"
fi

ok "デプロイ完了。受信は GAS の pollPubsub（1分毎トリガー）で行います。"

#!/usr/bin/env bash
# GCP の自動プロビジョニング（冪等）:
#   - API 有効化
#   - Pub/Sub トピック作成
#   - Meet イベント配信用 SA に Pub/Sub パブリッシャー付与（コンソールUIが弾く箇所）
source "$(dirname "$0")/lib.sh"

require_cmd gcloud
require_env GCP_PROJECT_ID PUBSUB_TOPIC

step "GCP プロビジョニング（project=$GCP_PROJECT_ID）"

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

info "API を有効化中…（数十秒かかることがあります）"
gcloud services enable \
  meet.googleapis.com \
  workspaceevents.googleapis.com \
  pubsub.googleapis.com \
  script.googleapis.com \
  --project "$GCP_PROJECT_ID"
ok "API 有効化完了"

info "Pub/Sub トピック '$PUBSUB_TOPIC' を確認/作成中…"
if gcloud pubsub topics describe "$PUBSUB_TOPIC" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  ok "トピックは既に存在"
else
  gcloud pubsub topics create "$PUBSUB_TOPIC" --project "$GCP_PROJECT_ID"
  ok "トピックを作成"
fi

info "Meet イベント配信 SA に Pub/Sub パブリッシャーを付与中…"
gcloud pubsub topics add-iam-policy-binding "$PUBSUB_TOPIC" \
  --member="serviceAccount:meet-api-event-pusher@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project "$GCP_PROJECT_ID" >/dev/null
ok "IAM 付与完了（コンソールUIで弾かれていた箇所はこれで解決）"

ok "GCP プロビジョニング完了"

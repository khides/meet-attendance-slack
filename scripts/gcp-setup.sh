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
  --member="serviceAccount:meet-api-event-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project "$GCP_PROJECT_ID" >/dev/null
ok "IAM 付与完了（コンソールUIで弾かれていた箇所はこれで解決）"

ok "GCP プロビジョニング完了"

# DWD モード: サービスアカウントの作成 + .env への秘密鍵注入
if [ "${AUTH_MODE:-}" = "dwd" ]; then
  step "DWD サービスアカウントを作成"
  SA_NAME="meet-dwd"
  SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

  if gcloud iam service-accounts describe "$SA_EMAIL" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    ok "SA は既に存在（$SA_EMAIL）"
  else
    gcloud iam service-accounts create "$SA_NAME" \
      --display-name="Meet DWD" \
      --project "$GCP_PROJECT_ID"
    ok "SA を作成（$SA_EMAIL）"
  fi

  if [ ! -f service-account.json ]; then
    gcloud iam service-accounts keys create service-account.json \
      --iam-account="$SA_EMAIL" \
      --project "$GCP_PROJECT_ID"
    ok "キーを生成 → service-account.json（gitignore 済み）"
  else
    ok "service-account.json は既に存在（スキップ）"
  fi

  info ".env に SA 認証情報を書き込み中…"
  node scripts/inject-sa.mjs
  ok ".env 更新完了（SA_CLIENT_EMAIL / SA_PRIVATE_KEY）"
fi

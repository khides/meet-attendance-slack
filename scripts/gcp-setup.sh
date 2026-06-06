#!/usr/bin/env bash
# GCP の自動プロビジョニング（冪等）:
#   - GCP プロジェクト作成（未存在時）
#   - API 有効化
#   - Pub/Sub トピック作成
#   - Meet イベント配信用 SA に Pub/Sub パブリッシャー付与（コンソールUIが弾く箇所）
#   - DWD サービスアカウント作成 + .env への秘密鍵注入（AUTH_MODE=dwd のとき）
source "$(dirname "$0")/lib.sh"

require_cmd gcloud
require_env GCP_PROJECT_ID PUBSUB_TOPIC

step "GCP プロジェクトを確認/作成（$GCP_PROJECT_ID）"

if gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  ok "GCP プロジェクトは既に存在（$GCP_PROJECT_ID）"
else
  info "GCP プロジェクト '$GCP_PROJECT_ID' を作成中…"
  # 組織ID: .env の GCP_ORG_ID → gcloud から自動検出 → なし（個人プロジェクト）の順
  ORG_ID="${GCP_ORG_ID:-}"
  if [ -z "$ORG_ID" ]; then
    ORG_ID="$(gcloud organizations list --format='value(ID)' 2>/dev/null | head -1)"
  fi
  if [ -n "$ORG_ID" ]; then
    gcloud projects create "$GCP_PROJECT_ID" \
      --organization="$ORG_ID" \
      --name="$GCP_PROJECT_ID"
    ok "GCP プロジェクトを作成（org: $ORG_ID）"
  else
    gcloud projects create "$GCP_PROJECT_ID" --name="$GCP_PROJECT_ID"
    ok "GCP プロジェクトを作成（個人プロジェクト）"
  fi
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null

info "API を有効化中…（数十秒かかることがあります）"
gcloud services enable \
  meet.googleapis.com \
  workspaceevents.googleapis.com \
  pubsub.googleapis.com \
  script.googleapis.com \
  orgpolicy.googleapis.com \
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
MEET_PUBLISHER_SA="meet-api-event-push@system.gserviceaccount.com"

grant_publisher() {
  gcloud pubsub topics add-iam-policy-binding "$PUBSUB_TOPIC" \
    --member="serviceAccount:${MEET_PUBLISHER_SA}" \
    --role="roles/pubsub.publisher" \
    --project "$GCP_PROJECT_ID" 2>"$BIND_ERR" >/dev/null
}

BIND_ERR="$(mktemp)"
if grant_publisher; then
  ok "IAM 付与完了"
else
  if grep -q "allowedPolicyMemberDomains\|permitted organization\|permitted customer" "$BIND_ERR"; then
    warn "組織ポリシー『ドメイン制限共有』が Google 管理 SA の追加をブロックしています。"
    cat <<EOF
  ${MEET_PUBLISHER_SA} は Google 所有のシステムアカウント（組織外）のため、
  制約 constraints/iam.allowedPolicyMemberDomains に阻まれています。

  対処（このプロジェクトのみ一時的に緩和 → 付与 → 元に戻す）:
    ・要 権限: roles/orgpolicy.policyAdmin（組織/プロジェクトのポリシー管理者）
    ・影響範囲: プロジェクト ${GCP_PROJECT_ID} のみ
EOF
    printf "%s" "${C_YELLOW}  権限があり、自動で緩和→付与→復元してよければ y を入力（それ以外で中断）: ${C_RESET}"
    read -r ANS
    if [ "$ANS" = "y" ] || [ "$ANS" = "Y" ]; then
      info "プロジェクト ${GCP_PROJECT_ID} の allowedPolicyMemberDomains を一時的に allowAll へ…"
      OP_YAML="$(mktemp)"
      cat > "$OP_YAML" <<EOF
name: projects/${GCP_PROJECT_ID}/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
  - allowAll: true
EOF
      if gcloud org-policies set-policy "$OP_YAML" --project "$GCP_PROJECT_ID" >/dev/null 2>&1; then
        ok "組織ポリシーを一時緩和"
        info "反映待ち（最大60秒）…"
        SUCCESS=0
        for _ in $(seq 1 12); do
          sleep 5
          if grant_publisher; then SUCCESS=1; break; fi
        done
        # 元のポリシー（プロジェクト override を削除＝組織既定へ戻す）
        gcloud org-policies reset constraints/iam.allowedPolicyMemberDomains \
          --project "$GCP_PROJECT_ID" >/dev/null 2>&1 \
          && ok "組織ポリシーを復元（プロジェクト override を削除）" \
          || warn "組織ポリシーの復元に失敗。手動で確認してください。"
        if [ "$SUCCESS" = "1" ]; then
          ok "IAM 付与完了"
        else
          err "緩和後も付与に失敗しました。少し時間をおいて再実行してください。"
          rm -f "$BIND_ERR" "$OP_YAML"
          exit 1
        fi
        rm -f "$OP_YAML"
      else
        err "組織ポリシーの変更に失敗（権限不足の可能性）。管理者に依頼してください。"
        cat <<EOF
  管理者向け手順（roles/orgpolicy.policyAdmin が必要）:
    cat > op.yaml <<'YAML'
    name: projects/${GCP_PROJECT_ID}/policies/iam.allowedPolicyMemberDomains
    spec:
      rules:
      - allowAll: true
    YAML
    gcloud org-policies set-policy op.yaml --project ${GCP_PROJECT_ID}
    # 緩和後に mise run setup を再実行。完了したら↓で復元:
    gcloud org-policies reset constraints/iam.allowedPolicyMemberDomains --project ${GCP_PROJECT_ID}
EOF
        rm -f "$BIND_ERR" "$OP_YAML"
        exit 1
      fi
    else
      err "中断しました。組織ポリシー緩和後に再実行してください。"
      rm -f "$BIND_ERR"
      exit 1
    fi
  else
    err "IAM 付与に失敗: $(cat "$BIND_ERR")"
    rm -f "$BIND_ERR"
    exit 1
  fi
fi
rm -f "$BIND_ERR"

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
    # SA 作成は結果整合性。describe が通るまで待ってから鍵を作る。
    info "SA の反映待ち…"
    for _ in $(seq 1 12); do
      gcloud iam service-accounts describe "$SA_EMAIL" --project "$GCP_PROJECT_ID" >/dev/null 2>&1 && break
      sleep 5
    done
  fi

  if [ ! -f service-account.json ]; then
    # 反映直後は鍵作成が NOT_FOUND になることがあるためリトライ
    KEY_OK=0
    for _ in $(seq 1 6); do
      if gcloud iam service-accounts keys create service-account.json \
          --iam-account="$SA_EMAIL" \
          --project "$GCP_PROJECT_ID" 2>/dev/null; then
        KEY_OK=1; break
      fi
      info "鍵作成リトライ中…"
      sleep 5
    done
    if [ "$KEY_OK" = "1" ]; then
      ok "キーを生成 → service-account.json（gitignore 済み）"
    else
      err "SA 鍵の生成に失敗しました。少し待って再実行してください。"
      exit 1
    fi
  else
    ok "service-account.json は既に存在（スキップ）"
  fi

  info ".env に SA 認証情報を書き込み中…"
  node scripts/inject-sa.mjs
  ok ".env 更新完了（SA_CLIENT_EMAIL / SA_PRIVATE_KEY）"
fi

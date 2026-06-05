#!/usr/bin/env bash
# 一括セットアップ。CLI自動化分を実行し、ブラウザ必須箇所は案内して一時停止する。
# 何度実行しても安全（冪等）。
source "$(dirname "$0")/lib.sh"

printf "%s\n" "${C_BOLD}meet-attendance-slack セットアップ${C_RESET}"
echo "CLIでできる所は自動化し、ブラウザが要る数ステップだけ案内します。"

# 0) ツール導入
step "0. ツール導入（mise: node, gcloud / npm 依存）"
if command -v mise >/dev/null 2>&1; then
  mise install
  # 同シェルで gcloud 等に PATH を通す
  eval "$(mise env -s bash 2>/dev/null || true)"
else
  warn "mise が見つかりません。https://mise.jdx.dev からインストール推奨。"
fi
npm ci || npm install
ok "依存導入完了"

# 1) .env
step "1. 設定（.env）"
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env を作成しました。値を入力してから再実行してください:"
  echo "    \$EDITOR .env   # GCP_PROJECT_ID, OAUTH_CLIENT_ID/SECRET, SLACK_WEBHOOK_URL, HOSTS"
  exit 1
fi
load_env
require_env AUTH_MODE GCP_PROJECT_ID PUBSUB_TOPIC SLACK_WEBHOOK_URL HOSTS
if [ "${AUTH_MODE}" = "oauth" ]; then
  require_env OAUTH_CLIENT_ID OAUTH_CLIENT_SECRET
fi
# dwd モードは SA_CLIENT_EMAIL / SA_PRIVATE_KEY を gcp-setup.sh が自動生成するため、ここでは不要
ok ".env OK"

# 2) 認証
step "2. ログイン確認（clasp / gcloud）"

# --- clasp ---
if [ ! -f "$HOME/.clasprc.json" ]; then
  warn "clasp 未ログイン。ブラウザが開きます → GAS を所有させたいアカウントでログインしてください。"
  npx clasp login || { err "clasp login 失敗"; exit 1; }
fi
# JWT の payload からメールを取得
CLASP_ACCOUNT="$(node -e "
  try {
    const rc = JSON.parse(require('fs').readFileSync(process.env.HOME+'/.clasprc.json','utf8'));
    const t = (rc.token||{}).id_token || '';
    if (!t) { process.stdout.write('(不明)'); process.exit(); }
    const p = JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
    process.stdout.write(p.email||'(不明)');
  } catch(e) { process.stdout.write('(解析失敗)'); }
" 2>/dev/null || echo "(不明)")"
info "clasp アカウント: ${C_BOLD}${CLASP_ACCOUNT}${C_RESET}"
warn "切り替える場合は Ctrl+C → npx clasp logout && npx clasp login → mise run setup を再実行"

# --- gcloud ---
if command -v gcloud >/dev/null 2>&1; then
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
    warn "gcloud 未ログイン。ブラウザが開きます。"
    gcloud auth login || true
  fi
  GCLOUD_ACTIVE="$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1)"
  GCLOUD_ALL="$(gcloud auth list --format="value(account)" 2>/dev/null)"
  GCLOUD_COUNT="$(echo "$GCLOUD_ALL" | grep -c .)"
  info "gcloud アクティブアカウント: ${C_BOLD}${GCLOUD_ACTIVE}${C_RESET}"
  if [ "${GCLOUD_COUNT}" -gt 1 ]; then
    echo "  ログイン済みアカウント一覧:"
    echo "$GCLOUD_ALL" | while IFS= read -r acc; do
      if [ "$acc" = "$GCLOUD_ACTIVE" ]; then
        printf "    * %s  (現在アクティブ)\n" "$acc"
      else
        printf "      %s\n" "$acc"
      fi
    done
    printf "%s" "${C_YELLOW}  切り替える場合はアカウントのメールを入力（そのまま Enter で ${GCLOUD_ACTIVE} を使用）: ${C_RESET}"
    read -r SWITCH_TO
    if [ -n "$SWITCH_TO" ]; then
      gcloud config set account "$SWITCH_TO"
      GCLOUD_ACTIVE="$SWITCH_TO"
      ok "gcloud アカウントを ${GCLOUD_ACTIVE} に切り替えました"
    fi
  fi
else
  warn "gcloud 未導入のままです。mise install を確認してください。"
fi

echo ""
info "続行アカウント: clasp=${CLASP_ACCOUNT} / gcloud=${GCLOUD_ACTIVE:-?}"
warn "問題があれば Ctrl+C で中断してください。"
pause
ok "ログイン確認 OK"

# Apps Script プロジェクトが未作成なら新規作成（.clasp.json は gitignore 済み）
if [ ! -f .clasp.json ]; then
  step "2b. Apps Script プロジェクトを新規作成"
  npx clasp create --type webapp --title "meet-attendance-slack" --rootDir dist
  ok "Apps Script プロジェクトを作成（.clasp.json に scriptId を保存）"
else
  SID_CHECK="$(script_id)"
  ok "Apps Script プロジェクト既存（scriptId: ${SID_CHECK}）"
fi

# 3) ブラウザ必須の手動ステップ（冪等チェック不可なので案内のみ）
SID="$(script_id)"
REDIRECT="https://script.google.com/macros/d/${SID}/usercallback"
step "3. ブラウザ必須の手動ステップ（未実施なら対応）"
cat <<EOF
  これらは Google がブラウザ操作を要求するため自動化できません。
  既に完了済みならスキップして Enter:

  (a) Apps Script API を有効化:
        https://script.google.com/home/usersettings → 「Google Apps Script API」をオン
EOF

if [ "${AUTH_MODE}" = "oauth" ]; then
  cat <<EOF
  (b) OAuth 同意画面（External）を設定し、テストユーザーに主催者(${HOSTS})を追加:
        https://console.cloud.google.com/auth/overview?project=${GCP_PROJECT_ID}
  (c) OAuth クライアント（ウェブ アプリ）を作成し、リダイレクト URI に↓を登録:
        ${REDIRECT}
      → 取得した Client ID/Secret を .env に記入（未記入なら今入れて再実行）
EOF
fi

cat <<EOF
  (d) Apps Script にこの GCP プロジェクトを紐付け（プロジェクト設定 → GCPプロジェクト番号）
EOF
pause

# DWD モード: ドメイン全体の委任はスクリプトが SA を作った後に案内
if [ "${AUTH_MODE}" = "dwd" ]; then
  step "3b. DWD: Workspace 管理コンソールでドメイン全体の委任を設定"
  cat <<EOF
  ※ この手順は次の gcp-setup.sh でサービスアカウントを作成してから行います。
     （下記の CLIENT_ID は gcp-setup.sh 完了後に確認できます）

  管理者コンソール（Workspace 管理者権限が必要）:
    https://admin.google.com →
      セキュリティ → アクセスとデータ管理 → APIの制御 →
      ドメイン全体の委任 → 新しく追加
        クライアントID  : service-account.json の "client_id" の値
        OAuth スコープ  : https://www.googleapis.com/auth/meetings.space.readonly

  ※ 自分が管理者でない場合は IT 管理者に依頼してください。
EOF
fi

# 4) GCP 自動プロビジョニング
bash scripts/gcp-setup.sh

# 5) デプロイ + push購読
bash scripts/deploy.sh

# 6) 残り（購読作成）
step "6. 最後のステップ"
cat <<EOF
  ${C_GREEN}自動化分は完了しました。${C_RESET}
  残りは主催者の同意 → 購読作成です:

    mise run subscribe

  （主催者 ${HOSTS} がブラウザで認可URLを開いて同意 → 購読が作成されます）

  動作確認:
    - Slack テスト投稿:  npx clasp run testSlack  （または エディタで testSlack 実行）
    - 対象 Meet に入室 → Slack に入室通知が出れば成功
EOF
ok "setup.sh 完了"

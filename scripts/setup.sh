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
# dwd モードは SA_CLIENT_EMAIL を gcp-setup.sh が自動生成するため、ここでは不要（キーレス）
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

# Apps Script プロジェクトを用意（.clasp.json は gitignore 済み）
APP_TITLE="meet-attendance-slack"
if [ ! -f .clasp.json ]; then
  step "2b. Apps Script プロジェクトを用意"
  EXISTING_SID="$(find_script_by_title "$APP_TITLE")"
  if [ -n "${EXISTING_SID:-}" ]; then
    # 同名の既存プロジェクトを再利用（.clasp.json を生成して紐付け）
    node -e "require('fs').writeFileSync('.clasp.json', JSON.stringify({scriptId:'${EXISTING_SID}',rootDir:'dist'},null,2))"
    ok "同名の既存スクリプトを再利用（scriptId: ${EXISTING_SID}）"
    info "新規に作り直したい場合は↑のスクリプトを削除してから再実行"
  else
    npx clasp create --type webapp --title "$APP_TITLE" --rootDir dist
    ok "Apps Script プロジェクトを作成（.clasp.json に scriptId を保存）"
  fi
else
  SID_CHECK="$(script_id)"
  ok "Apps Script プロジェクト既存のためスキップ（scriptId: ${SID_CHECK}）"
  info "別のスクリプトを使いたい場合は rm .clasp.json して再実行"
fi

# 2c) GCP 自動プロビジョニング（プロジェクト作成・API・トピック・IAM・DWD SA）
#     先に実行しておくことで、後続の手動ステップで GCP プロジェクト番号と
#     DWD の client_id を提示できる。
bash scripts/gcp-setup.sh

# 3) ブラウザ必須の手動ステップ（冪等チェック不可なので案内のみ）
SID="$(script_id)" || true
SID="${SID:-}"
REDIRECT="https://script.google.com/macros/d/${SID}/usercallback"

# GCP プロジェクト番号（Apps Script への紐付けで必要。gcp-setup 後なので取得可能）
GCP_PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"

step "3. ブラウザ必須の手動ステップ（未実施なら対応）"
cat <<EOF
  これらは Google がブラウザ操作を要求するため自動化できません。
  既に完了済みならスキップして Enter:

  (a) Apps Script API を有効化:
        https://script.google.com/home/usersettings → 「Google Apps Script API」をオン

  (b) OAuth 同意画面を設定（GCP を Apps Script に紐付けるのに必須）:
        https://console.cloud.google.com/auth/overview?project=${GCP_PROJECT_ID}
        Workspace プロジェクトなら「内部」を推奨（テストユーザー追加不要）
EOF

if [ "${AUTH_MODE}" = "oauth" ]; then
  cat <<EOF
  (c) OAuth クライアント（ウェブ アプリ）を作成し、リダイレクト URI に↓を登録:
        ${REDIRECT}
      → 取得した Client ID/Secret を .env に記入（未記入なら今入れて再実行）
EOF
fi

cat <<EOF
  (d) Apps Script にこの GCP プロジェクトを紐付け:
        スクリプトエディタ → 歯車アイコン（プロジェクトの設定）→
        「Google Cloud Platform プロジェクト」→ 以下の番号を入力:

          GCP プロジェクト番号: ${C_BOLD}${GCP_PROJECT_NUMBER:-（取得失敗。gcloud projects describe ${GCP_PROJECT_ID} で確認）}${C_RESET}

        スクリプト: https://script.google.com/d/${SID}/edit
EOF

# DWD モード: gcp-setup が SA を作成済みなので client_id を提示できる
if [ "${AUTH_MODE}" = "dwd" ]; then
  SA_CLIENT_ID="$(cat .sa_oauth_client_id 2>/dev/null || true)"
  cat <<EOF

  (e) DWD: Workspace 管理コンソールでドメイン全体の委任を設定（管理者権限が必要）:
        https://admin.google.com →
          セキュリティ → アクセスとデータ管理 → APIの制御 →
          ドメイン全体の委任 → 新しく追加

          クライアントID  : ${C_BOLD}${SA_CLIENT_ID:-（gcloud iam service-accounts describe meet-dwd@${GCP_PROJECT_ID}.iam.gserviceaccount.com --format='value(oauth2ClientId)' で確認）}${C_RESET}
          OAuth スコープ  : https://www.googleapis.com/auth/meetings.space.readonly

      ※ 自分が管理者でない場合は IT 管理者に依頼してください。
      ※ キーレス方式です。SA の秘密鍵はダウンロードしません。
EOF
fi
pause

# 4) デプロイ + pull購読
bash scripts/deploy.sh

# 5) 残り（購読作成）
step "5. 最後のステップ"
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

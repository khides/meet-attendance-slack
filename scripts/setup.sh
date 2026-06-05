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
ok ".env OK"

# 2) 認証
step "2. ログイン確認（clasp / gcloud）"
if [ ! -f "$HOME/.clasprc.json" ]; then
  warn "clasp 未ログイン。別ターミナルで 'npx clasp login'（主催者の個人Gmail）を実行してください。"
  pause
fi
if command -v gcloud >/dev/null 2>&1; then
  if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
    warn "gcloud 未ログイン。'gcloud auth login' を実行してください。"
    gcloud auth login || true
  fi
else
  warn "gcloud 未導入のままです。mise install を確認してください。"
fi
ok "ログイン確認 OK"

# 3) ブラウザ必須の手動ステップ（冪等チェック不可なので案内のみ）
SID="$(script_id)"
REDIRECT="https://script.google.com/macros/d/${SID}/usercallback"
step "3. ブラウザ必須の手動ステップ（未実施なら対応）"
cat <<EOF
  これらは Google がブラウザ操作を要求するため自動化できません。
  既に完了済みならスキップして Enter:

  (a) Apps Script API を有効化:
        https://script.google.com/home/usersettings → 「Google Apps Script API」をオン
  (b) OAuth 同意画面（External）を設定し、テストユーザーに主催者(${HOSTS})を追加:
        https://console.cloud.google.com/auth/overview?project=${GCP_PROJECT_ID}
  (c) OAuth クライアント（ウェブ アプリ）を作成し、リダイレクト URI に↓を登録:
        ${REDIRECT}
      → 取得した Client ID/Secret を .env に記入（未記入なら今入れて再実行）
  (d) Apps Script にこの GCP プロジェクトを紐付け（プロジェクト設定 → GCPプロジェクト番号）
EOF
pause

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

#!/usr/bin/env bash
# 主催者の購読作成 + 更新トリガー登録。
# oauth: 主催者が OAuth 同意済みか確認してから購読作成。
# dwd  : 管理者委任で動くため主催者の個別同意は不要。直接購読作成。
source "$(dirname "$0")/lib.sh"

require_cmd npx

if [ "${AUTH_MODE:-oauth}" != "dwd" ]; then
  step "主催者の OAuth 同意状況を確認"
  # clasp run で未認可主催者の認可URLを取得（失敗時はエディタ実行を案内）
  if npx clasp run showPendingAuthorizations >/tmp/mas_pending.txt 2>/tmp/mas_pending.err; then
    if grep -q "https://" /tmp/mas_pending.txt; then
      warn "未認可の主催者がいます。以下の URL を主催者本人がブラウザで開いて同意してください:"
      grep -o "https://[^ ]*" /tmp/mas_pending.txt
      pause
    else
      ok "全主催者が認可済み"
    fi
  else
    warn "clasp run が使えませんでした。Apps Script エディタで手動実行してください:"
    echo "    1) エディタを開く:  npx clasp open"
    echo "    2) 関数 showPendingAuthorizations を実行 → ログの認可URLを主催者が開いて同意"
    echo "    3) 関数 createAllSubscriptions を実行"
    echo "    4) 関数 installRenewTrigger を実行"
    echo "  （clasp run には appsscript.json の executionApi に加え、デスクトップ用OAuth"
    echo "    クライアントでの 'npx clasp login --creds creds.json' が必要です）"
    exit 0
  fi
else
  ok "DWD モード: 主催者の個別 OAuth 同意は不要（ドメイン全体委任で認可済み）"
fi

editor_fallback() {
  warn "clasp run が使えませんでした（要・デスクトップOAuth資格情報）。"
  cat <<EOF
  Apps Script エディタで以下の関数を順番に実行してください:
    1) npx clasp open
    2) createAllSubscriptions   … 監視対象スペースの購読を作成
    3) installPollTrigger        … Pub/Sub を1分毎にポーリング（受信の本体）
    4) installRenewTrigger       … 購読TTLを12時間毎に延長

  ※ 初回実行時に新しい権限（cloud-platform 等）の承認が求められます。
    画面の指示に従って許可してください。
EOF
  exit 0
}

step "購読を作成"
npx clasp run createAllSubscriptions || editor_fallback
ok "購読を作成"

step "ポーリングトリガーを登録（1分毎・受信本体）"
npx clasp run installPollTrigger || editor_fallback
ok "ポーリングトリガーを登録"

step "更新トリガーを登録（12時間毎・TTL延長）"
npx clasp run installRenewTrigger || warn "installRenewTrigger はエディタで実行してください。"
ok "サブスクリプション設定完了"

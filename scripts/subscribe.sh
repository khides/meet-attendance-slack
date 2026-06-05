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

step "購読を作成"
npx clasp run createAllSubscriptions || {
  warn "createAllSubscriptions の clasp run に失敗。エディタで実行してください（npx clasp open）。"
  exit 0
}
ok "購読を作成"

step "更新トリガーを登録（12時間毎・TTL延長）"
npx clasp run installRenewTrigger || warn "installRenewTrigger はエディタで実行してください。"
ok "サブスクリプション設定完了"

#!/bin/bash
# launcher-app.sh — 「OpenCode 皮肤.app」双击后执行的本体（make-launcher.sh 生成的 app 指向这里）
#
# 双击行为：
#   OpenCode 在跑且皮肤在   → 什么都不做（最常见情况，静默退出）
#   OpenCode 在跑但皮肤丢了 → 按上次主题自动恢复（不重启 OpenCode），成功后弹系统通知
#   OpenCode 在跑但端口丢了 → 弹窗指引恢复命令（普通重启会丢端口，需要 apply-skin.sh）
#   OpenCode 没在运行       → 弹窗提示用 apply-skin.sh 首次启用
# 顺带自检守护进程：没在跑就重新拉起。
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${OPENCODE_SKIN_CDP_PORT:-9345}"
SELFTEST="${1:-}"

notify() {
  osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
}
dialog() {
  osascript -e "display dialog \"$2\" with title \"$1\" buttons {\"好\"} default button 1" >/dev/null 2>&1 || true
}

# 自测模式（make-launcher.sh 生成后跑一遍验证，不打扰屏幕）
if [ "$SELFTEST" = "--selftest" ]; then
  echo "selftest ok"
  exit 0
fi

# 守护进程自检：没在跑就拉起
if ! pgrep -f "opencode-skin/daemon.mjs" >/dev/null 2>&1; then
  bash "${DIR}/install-daemon.sh" >/dev/null 2>&1 || true
fi

if ! pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1; then
  dialog "OpenCode 皮肤" "OpenCode 没在运行。首次启用请执行：bash ${DIR}/apply-skin.sh"
  exit 0
fi

# 端口检查
if ! curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  dialog "OpenCode 皮肤" "OpenCode 在运行但没带调试端口（被普通方式重启过）。恢复皮肤请执行：bash ${DIR}/apply-skin.sh"
  exit 0
fi

# 皮肤在不在：在就静默退出；不在就按 state 里的主题恢复
STATUS="$(node "${DIR}/apply.mjs" --status --port "${PORT}" 2>/dev/null || echo '{}')"
if echo "$STATUS" | grep -q '"skin": *true'; then
  exit 0
fi

THEME="$(cd "$DIR" && node --input-type=module -e "
const m = await import(\"${DIR}/lib/state.mjs\");
const s = await m.readState();
console.log(s.theme || \"\");
" 2>/dev/null || true)"

if [ -z "$THEME" ]; then
  notify "OpenCode 皮肤" "皮肤未启用（当前官方外观）"
  exit 0
fi

if node "${DIR}/apply.mjs" --theme "$THEME" --port "$PORT" --wait 30000 >/dev/null 2>&1; then
  notify "OpenCode 皮肤" "已恢复上次皮肤（${THEME}）"
else
  dialog "OpenCode 皮肤" "皮肤恢复失败。请跑诊断：node ${DIR}/diag.mjs"
fi

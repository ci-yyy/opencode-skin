#!/bin/bash
# apply-skin.sh — 首次启用 / 端口丢失后恢复：
#   退出 OpenCode → 带调试端口(9345)重启 → 等主窗口就绪并注入当前主题
# 会话数据不受影响（只是重启时多了两个调试参数）。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${OPENCODE_SKIN_CDP_PORT:-9345}"

echo "==> 1/3 退出 OpenCode"
if pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1; then
  osascript -e 'quit app "OpenCode"' >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do
    pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1; then
    echo "❌ OpenCode 没能在 20 秒内退出，请手动退出后重试" >&2
    exit 1
  fi
else
  echo "    （OpenCode 未在运行）"
fi

echo "==> 2/3 带调试端口重启 OpenCode"
open -a "OpenCode" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="${PORT}"

echo "==> 3/3 等主窗口就绪并注入皮肤（首次启动要等应用主题落定，约 10~20 秒）"
node "${DIR}/skin.mjs" inject --wait 60000

echo
echo "✅ 完成。日常换主题：bash ${DIR}/use-skin.sh · 自动恢复守护进程：bash ${DIR}/install-daemon.sh"

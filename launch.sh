#!/bin/bash
# launch.sh — 旧版启动器（已被 apply-skin.sh 取代，保留备用）
# 手动带端口启动 OpenCode（效果等同 apply-skin.sh 的重启步骤，但不动已在运行的实例）

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${OPENCODE_SKIN_CDP_PORT:-9345}"

if pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1; then
  echo "ℹ️ OpenCode 已在运行。要带端口重启请用：bash ${DIR}/apply-skin.sh"
  exit 0
fi

echo "==> 带调试端口启动 OpenCode"
open -a "OpenCode" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="${PORT}"
echo "==> 等主窗口就绪并注入皮肤"
node "${DIR}/apply.mjs" --port "${PORT}" --wait 60000

#!/bin/bash
# uninstall-daemon.sh — 卸载皮肤守护进程（LaunchAgent + 进程）
set -euo pipefail
LABEL="com.opencode.skin.daemon"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
rm -f "${PLIST}"
pkill -f "opencode-skin/daemon.mjs" >/dev/null 2>&1 || true
echo "✅ 守护进程已卸载（已注入的皮肤不受影响，重启 OpenCode 后自然消失）"

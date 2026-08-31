#!/bin/bash
# install-daemon.sh — 安装皮肤守护进程（LaunchAgent）：
#   OpenCode 刷新/重启后自动补回皮肤；被普通方式重启（端口丢失）时弹系统通知提醒
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node)"
LABEL="com.opencode.skin.daemon"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${DIR}/logs"
mkdir -p "${LOG_DIR}"

if [ -z "${NODE_BIN}" ]; then
  echo "❌ 找不到 node（需要 Node 22+）" >&2
  exit 1
fi

# 已装先卸（幂等重装）
launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 && {
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
}

cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${DIR}/daemon.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/launchd-out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/launchd-err.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "${PLIST}"
sleep 2
# 幂等重装：bootout 已把旧实例停掉，这里跑起来的一定是新代码。
# 注意：手动改过代码后必须重跑本脚本（或先 bash uninstall-daemon.sh），
# 否则页面上可能还是旧进程注入的旧皮肤——观感不更新且极难排查
if pgrep -f "opencode-skin/daemon.mjs" >/dev/null 2>&1; then
  echo "✅ 守护进程已安装并运行（LaunchAgent：${LABEL}）"
  echo "   日志：${LOG_DIR}/daemon.log · 卸载：bash ${DIR}/uninstall-daemon.sh"
else
  echo "⚠️ 守护进程可能没起来，看日志排查：${LOG_DIR}/launchd-err.log" >&2
  exit 1
fi

#!/bin/bash
# apply-skin.sh — 首次启用 / 端口丢失后恢复
#
# 重启动作用 launchd 一次性任务执行（relaunch-via-launchd.sh）：脚本属于 macOS，
# 独立于 OpenCode 与调用方终端存活，中途关终端、退会话都不影响。
# 保底：无论哪步失败，最后都会确保 OpenCode 处于运行状态。
#
# 用法：bash apply-skin.sh    （重复执行 = 幂等重做一遍）

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${OPENCODE_SKIN_CDP_PORT:-9345}"
LABEL="com.opencode.skin.relaunch"
PLIST="/tmp/${LABEL}.plist"
MARK_FILE="/tmp/opencode-skin-relaunch.done"

# 结束时注销 launchd 任务、删临时 plist（Ctrl+C / 出错也走这里）
cleanup() {
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  rm -f "$PLIST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -f "$MARK_FILE"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${DIR}/relaunch-via-launchd.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${PORT}</string>
    <key>MARK_FILE</key><string>${MARK_FILE}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${DIR}/logs/relaunch-out.log</string>
  <key>StandardErrorPath</key><string>${DIR}/logs/relaunch-err.log</string>
</dict>
</plist>
EOF

mkdir -p "${DIR}/logs"
echo "==> 通过 launchd 重启 OpenCode（带端口 ${PORT}）并注入皮肤"
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# 等结果标记（重启 + 等主题落定 + 注入，最长 2 分钟）
for _ in $(seq 1 240); do
  if [ -f "$MARK_FILE" ]; then
    if grep -q '^ok$' "$MARK_FILE"; then
      echo "✅ 完成：OpenCode 已带端口运行，皮肤已注入"
      echo "   日常换主题：bash ${DIR}/use-skin.sh · 守护进程：bash ${DIR}/install-daemon.sh"
      exit 0
    else
      echo "❌ 重启器报告失败，看日志：${DIR}/logs/relaunch.log" >&2
      exit 1
    fi
  fi
  sleep 0.5
done

echo "⚠️ 2 分钟没等到结果标记（可能在慢机器上仍在跑），看日志：${DIR}/logs/relaunch.log" >&2
exit 1

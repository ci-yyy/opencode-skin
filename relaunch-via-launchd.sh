#!/bin/bash
# relaunch-via-launchd.sh — 由 launchd（系统服务）执行的一次性重启器
#
# 为什么用它：如果这个脚本由 OpenCode 内的会话启动，OpenCode 退出时会把脚本一起杀掉，
# 没人负责把 OpenCode 拉回来。挂到 launchd 后，脚本属于 macOS，独立于 OpenCode 存活，
# 能完整跑完全部三步。
#
# 三步：退出 OpenCode → 带调试端口 9345 重启 → 注入主题
# 保底：无论注入成功与否，最后都会确认 OpenCode 已在运行；失败也会把 OpenCode 拉起来。

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-9345}"
LOG_DIR="$DIR/logs"
LOG="$LOG_DIR/relaunch.log"
MARK_FILE="${MARK_FILE:-/tmp/opencode-skin-relaunch.done}"
mkdir -p "$LOG_DIR"

exec >>"$LOG" 2>&1

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1"; }

# launchd 环境的 PATH 很精简（/usr/bin:/bin:...），nvm/homebrew 装的 node 不在里面，
# 注入步骤需要 node，这里按常见位置探测出绝对路径
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME"/.nvm/versions/node/*/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
[ -n "$NODE_BIN" ] && log "使用 node：$NODE_BIN" || log "警告：找不到 node，注入步骤会失败"

# 主进程探测：ps comm 精确匹配主可执行文件名
opencode_running() {
  pgrep -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1
}

wait_exit() {
  local i
  for i in $(seq 1 80); do
    opencode_running || return 0
    sleep 0.25
  done
  return 1
}

log "=== 一次性重启开始（pid $$） ==="

# 1. 退出 OpenCode（已经在 launchd 上下文里，不会被连带杀掉）
if opencode_running; then
  log "退出 OpenCode"
  osascript -e 'quit app "OpenCode"' >/dev/null 2>&1 || true
  if wait_exit; then
    log "OpenCode 已退出"
  else
    log "20 秒没退干净，强制 kill"
    pkill -f "OpenCode.app/Contents/MacOS/OpenCode" >/dev/null 2>&1 || true
    sleep 2
  fi
else
  log "OpenCode 未在运行"
fi

# 2. 带调试端口重启
log "带端口 ${PORT} 重启 OpenCode"
open -a "OpenCode" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="${PORT}"

# 3. 注入（等主窗口 + 等应用主题落定，最多 90 秒）
if [ -n "$NODE_BIN" ]; then
  log "注入主题"
  if "$NODE_BIN" "$DIR/apply.mjs" --port "$PORT" --wait 90000; then
    log "注入成功"
  else
    log "注入失败（保底：确认 OpenCode 在运行即可）"
  fi
else
  log "跳过注入（找不到 node）"
fi

# 保底：确认 OpenCode 在运行
sleep 3
if opencode_running; then
  log "保底确认：OpenCode 在运行 ✓"
  echo ok > "$MARK_FILE"
else
  log "保底拉起 OpenCode"
  open -a "OpenCode"
  sleep 3
  if opencode_running; then
    echo ok > "$MARK_FILE"
  else
    echo fail > "$MARK_FILE"
  fi
fi
log "=== 一次性重启结束 ==="

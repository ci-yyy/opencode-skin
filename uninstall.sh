#!/bin/bash
# uninstall.sh — 一键卸载：页面注入 + 守护进程 + 状态 + 日志
# 默认保留工具目录（里面是源码）；确认不要了加 --purge 连目录一起删
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PURGE=0
for arg in "$@"; do
  case "${arg}" in
    --purge) PURGE=1 ;;
    *) echo "未知参数：${arg}（可用：--purge）" >&2; exit 1 ;;
  esac
done

echo "==> 1/3 移除页面里的皮肤"
if node "${DIR}/skin.mjs" remove >/dev/null 2>&1; then
  echo "    已移除（OpenCode 正在带调试端口运行时）"
else
  echo "    （OpenCode 没带调试端口在运行，跳过——这种状态下重启 OpenCode 皮肤本来就会消失）"
fi

echo "==> 2/3 卸载守护进程"
bash "${DIR}/uninstall-daemon.sh" || true

echo "==> 3/3 清理状态与日志"
rm -f "${DIR}/state.json" "${DIR}/logs/daemon.log" "${DIR}/logs/daemon.log.1" \
      "${DIR}/logs/launchd-out.log" "${DIR}/logs/launchd-err.log"

if [ "${PURGE}" = "1" ]; then
  # 特征文件校验：防止脚本被拷到别处误删别人的目录
  if [ -f "${DIR}/skin.mjs" ] && [ -f "${DIR}/uninstall.sh" ]; then
    rm -rf "${DIR}"
    echo "✅ 已删除工具目录：${DIR}"
  else
    echo "❌ 目录特征不符，拒绝删除：${DIR}" >&2
    exit 1
  fi
else
  echo "✅ 卸载完成（工具目录保留：${DIR}，确认不要了可加 --purge）"
fi

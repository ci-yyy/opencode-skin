#!/bin/bash
# use-skin.sh — 日常换肤入口（菜单实现在 lib/menu.mjs）
#   bash use-skin.sh           交互菜单
#   bash use-skin.sh 3         按编号切换
#   bash use-skin.sh 樱雾粉     按名字切换
#   bash use-skin.sh 还原       恢复官方外观
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "${DIR}/lib/menu.mjs" "$@"

#!/bin/bash
# make-launcher.sh — 在 ~/Applications 生成「OpenCode 皮肤.app」启动器
#
# app 结构：Contents/MacOS/OpenCodeSkinLauncher 是 3 行 bash 包装，指向本目录的
# launcher-app.sh（逻辑住在仓库里，改逻辑不用重新生成）。
# LSUIElement=true：双击不占 Dock、不闪菜单栏，跑完静默退出
# （成功走系统通知，需要用户行动的指引才弹窗）。
#
# 用法：bash make-launcher.sh    （重复执行 = 覆盖升级）
# 生成后自动做结构与语法自检，并试跑一遍 launcher-app.sh（自测模式，不打扰屏幕）。

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Applications/OpenCode 皮肤.app"
EXE="$APP_DIR/Contents/MacOS/OpenCodeSkinLauncher"

if [ ! -f "$DIR/launcher-app.sh" ]; then
  echo "❌ 找不到 ${DIR}/launcher-app.sh（启动器逻辑文件），请在完整的项目目录里运行"
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# 包装脚本只需要嵌入工具目录绝对路径（esc 处理反斜杠和双引号）
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
ESC_DIR="$(esc "$DIR")"

cat > "$EXE" <<EOF
#!/bin/bash
# 「OpenCode 皮肤」启动器包装：实际逻辑在工具目录的 launcher-app.sh 里
exec /bin/bash "${ESC_DIR}/launcher-app.sh" "\$@"
EOF
chmod +x "$EXE"

cat > "$APP_DIR/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>OpenCode 皮肤</string>
  <key>CFBundleDisplayName</key><string>OpenCode 皮肤</string>
  <key>CFBundleIdentifier</key><string>com.opencode.skin.launcher</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>OpenCodeSkinLauncher</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

# 结构与语法自检
[ -x "$EXE" ] || { echo "❌ 可执行文件生成失败"; exit 1; }
plutil -lint "$APP_DIR/Contents/Info.plist" >/dev/null 2>&1 || { echo "❌ Info.plist 不合法"; exit 1; }
bash -n "$DIR/launcher-app.sh" || { echo "❌ launcher-app.sh 语法错误"; exit 1; }

# 免打扰自测
if OUT="$(bash "$DIR/launcher-app.sh" --selftest 2>&1)" && [ "$OUT" = "selftest ok" ]; then
  echo "✅ 启动器已生成：${APP_DIR}"
  echo "   双击行为：皮肤丢了自动恢复（不重启 OpenCode）· 端口丢了弹窗指引 · 顺带自检守护进程"
else
  echo "⚠️ 启动器已生成但自测未通过：$OUT" >&2
  exit 1
fi

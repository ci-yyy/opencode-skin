---
name: opencode-skin
description: Use when 用户想给 OpenCode 桌面客户端换皮肤、装主题、做主题、恢复官方外观，或设置皮肤常驻等选项。
---

# OpenCode Skin（OpenCode 桌面客户端换肤）

工具位置以用户实际安装为准。下文用 `$SKIN` 指代该目录。
原理：OpenCode 带 `--remote-debugging-port=9345` 启动后，通过 CDP 往界面注入主题 CSS
（只覆盖 CSS 变量），不修改应用本体、签名或会话数据。

## 必须遵守

1. **绝不擅自重启 OpenCode**。唯一允许的重启入口是用户明确同意后执行 `$SKIN/apply-skin.sh`
   （自带"退出→带端口重启→注入→保底拉起"的完整链路）。
2. 日常切换主题**不需要重启**：`bash $SKIN/use-skin.sh 主题名` 立即生效。
3. 判断状态用只读命令：`node $SKIN/apply.mjs --status`，不要用重启代替状态检查。
4. 失败后不做无界重试；保留原始错误再决定下一步。
5. 工具目录不能位于「下载/桌面/文稿」（macOS TCC 保护，launchd 无法执行其中的脚本）。

## 常用操作

| 意图 | 命令 |
|---|---|
| 列出主题 | `node $SKIN/apply.mjs --list` |
| 切换主题（立即生效） | `bash $SKIN/use-skin.sh <编号/名字/目录名>` |
| 还原官方外观 | `bash $SKIN/use-skin.sh 还原` |
| 查状态 | `node $SKIN/apply.mjs --status` |
| 首次启用 / 端口丢失后恢复 | `bash $SKIN/apply-skin.sh`（会重启 OpenCode，先征得用户同意） |
| 一站式体检 | `node $SKIN/diag.mjs`（守护进程/端口/主窗口/注入/state/主题目录，带修复指引） |
| 装守护进程（皮肤保活/通知） | `bash $SKIN/install-daemon.sh` |
| 卸载守护进程 | `bash $SKIN/uninstall-daemon.sh` |
| 彻底卸载（页面注入/守护进程/launchd/工具目录） | `bash $SKIN/uninstall.sh`（`--purge` 连目录删） |
| 生成「OpenCode 皮肤.app」启动器 | `bash $SKIN/make-launcher.sh` |
| 一张图做主题 | `node $SKIN/create-theme.mjs --image <图> --name "名字"` |

## 语义

- **皮肤常驻**（默认开）：OpenCode 刷新/重启后守护进程自动恢复皮肤。关掉后本次会话继续用，
  下次启动恢复官方外观。开关：`node $SKIN/skin.mjs persistence on|off`。
- **两种主题模式**：调色板（完整语义配色 + 可选背景图/渐变，观感即主题原设）和色相配方
  （一个 hue 自适应染色当前界面）。
- **生成主题**：`create-theme.mjs` 走「渲染进程取色 → 深浅判定 → 主色可读性校正 → 39 键语义配色」。

# 更新日志（CHANGELOG）

## 0.1.0（2026-08-31）首个公开版本

- **换肤引擎双模式**：
  - **调色板模式**（主力）：主题携带完整语义配色（39 个语义色），按固定映射表
    （`ZC_TO_OC`）直译到 OpenCode 的 `--v2-*` 变量，颜色值一字不改，主题设计成什么样
    界面上就是什么样；背景图嵌入 data URL 铺满整窗，全窗底色变量 alpha 按主题
    `surfaceAlpha`（默认 55%）改写让图透出
  - **配方模式**（补充）：`themes/<id>.json` 只写一个 `hue`，收割 OpenCode 当前真实配色、
    保亮度/饱和度结构整体换色相
- **入口齐备**：`use-skin.sh`（交互菜单，编号/名字/还原）、`apply-skin.sh`
  （带端口重启+注入）、`skin.mjs`（list/status/inject/remove/persistence/shot）、
  `install-daemon.sh` / `uninstall-daemon.sh` / `uninstall.sh`
- **守护进程**（LaunchAgent）：每 5 秒巡检，OpenCode 刷新/重启后自动补回皮肤；
  端口消失（被普通方式重启）时弹 macOS 系统通知。绝不主动重启 OpenCode
- **防竞态**：CLI 换肤写 `state.json` 的 `busyUntil` 置忙、守护进程让行，杜绝双重染色；
  注入前等 DOM 就绪 + 等应用自己的主题落定（AMOLED 等在启动数秒后才应用）
- **28 套内置主题**：14 套背景图 + 8 套渐变 + 6 套色相配方
- **测试**：23 个用例（node --test，零依赖）——色彩数学、调色板映射、alpha 改写、
  主题合法性、状态读写

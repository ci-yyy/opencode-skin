# OpenCode Skin | OpenCode 换肤工具

<div align="center">

**写代码的地方，也该是你喜欢的样子。**

28 套内置主题：22 套背景图/渐变 + 6 套色相配方。装好之后换肤只是终端里的一次回车，随时一键还原官方外观。

*Reskin OpenCode Desktop through loopback CDP injection. Native controls stay fully interactive.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-black)
![Node](https://img.shields.io/badge/node-%3E%3D22-339933)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

[快速开始](#快速开始macos) · [内置-28-套主题](#内置-28-套主题) · [工作原理](#工作原理) · [使用须知](#使用须知都是实话)

</div>

## 快速开始（macOS）

环境要求：macOS + Node.js 22 及以上（零 npm 依赖，CDP 通信用 Node 自带的 WebSocket 和 fetch）。
OpenCode 默认不带调试端口，换肤前先执行一次：

```bash
bash apply-skin.sh        # 退出 OpenCode → 带端口(9345)重启 → 注入默认主题，会话数据不丢
bash install-daemon.sh    # 可选：皮肤保活 + 恢复提醒（刷新/重启后自动补回）
bash uninstall.sh         # 卸载：页面注入 + 守护进程 + 状态日志（--purge 连目录删）
```

日常换肤**不重启 OpenCode、立即生效**：

```bash
bash use-skin.sh          # 交互菜单：输入编号或名字切换
bash use-skin.sh 21       # 按编号切换
bash use-skin.sh 折纸      # 按名字切换（支持中文模糊匹配）
bash use-skin.sh 还原      # 移除皮肤，恢复官方外观
```

名字匹配规则：先按目录名匹配，再按显示名模糊匹配（忽略空格和中点，「鸣潮声骸」「鸣潮 声骸」「鸣潮」效果相同）。

> ⚠️ 工具目录不要放在「下载」「桌面」「文稿」这类受 macOS 隐私保护的文件夹：launchd 无法执行其中的脚本，`install-daemon.sh` 会失败。

## 内置 28 套主题

**22 套背景图/渐变主题**（14 套背景图 + 8 套渐变，完整语义配色直译注入，观感即主题原设）+ 6 套色相配方，编号与 `use-skin.sh` 菜单序号一致：

| # | 目录名 | 名称 | 深浅 | 类型 |
|---|---|---|---|---|
| 1 | amber-glow | 琥珀暖光 | 🌙 | 色相配方 |
| 2 | cyber-neon | 赛博霓虹 | 🌙 | 渐变 |
| 3 | dalao-dianyan | 大佬 · 点烟 | 🌙 | 背景图 |
| 4 | deep-teal | 深海青 | 🌙 | 色相配方 |
| 5 | deepspace-dawn | 恋与深空 · 晨曦 | ☀️ | 背景图 |
| 6 | deepspace-star | 恋与深空 · 星辰 | 🌙 | 背景图 |
| 7 | default | 极光蓝 · 玻璃 | 🌙 | 渐变 |
| 8 | dragonball-nimbus | 龙珠 · 筋斗云 | ☀️ | 背景图 |
| 9 | dragonball-super-saiyan | 龙珠 · 超级赛亚人 | ☀️ | 背景图 |
| 10 | forest-moss | 苔原绿 | 🌙 | 色相配方 |
| 11 | forest-rain | 雨林墨绿 | 🌙 | 渐变 |
| 12 | genshin-dawn | 原神 · 晨曦 | ☀️ | 背景图 |
| 13 | genshin-night | 原神 · 星夜 | 🌙 | 背景图 |
| 14 | grape-soda | 葡萄气泡 | 🌙 | 渐变 |
| 15 | miku-488137 | Miku 488137 | ☀️ | 背景图 |
| 16 | mint-dawn | 薄荷晨雾 | ☀️ | 渐变 |
| 17 | mysterious-revival | 神秘复苏 | 🌙 | 背景图 |
| 18 | naruto-hokage | 火影 · 鸣人 | 🌙 | 背景图 |
| 19 | naruto-sasuke | 火影 · 佐助 | 🌙 | 背景图 |
| 20 | ocean-blue | 碧海蓝 | 🌙 | 色相配方 |
| 21 | origami | 折纸 | 🌙 | 背景图 |
| 22 | paper-cream | 宣纸米白 | ☀️ | 渐变 |
| 23 | sakura-mist | 樱雾粉青 | 🌙 | 渐变 |
| 24 | sakura-rose | 樱粉雾色 | 🌙 | 色相配方 |
| 25 | sunset-gold | 落日熔金 | 🌙 | 渐变 |
| 26 | violet-dusk | 紫暮 | 🌙 | 色相配方 |
| 27 | wuthering-echo | 鸣潮 · 共鸣 | 🌙 | 背景图 |
| 28 | wuthering-tide | 鸣潮 · 声骸 | 🌙 | 背景图 |

动漫背景图版权归各自权利人，仅供个人使用。

## 工作原理

注入走本机回环 CDP（`127.0.0.1:9345`），只往 OpenCode 渲染进程插一个 `<style>` 覆盖 CSS 变量，
**不修改应用本体、不动签名、不碰会话数据**。两种主题模式：

**调色板模式（22 套背景图/渐变主题）**——每个主题是一份完整的语义配色（`colors`，39 个语义色
`sidebar`/`card`/`foreground`/`brand`…），引擎按固定映射表（`lib/palette.mjs` 的 `ZC_TO_OC`）直译到
OpenCode 的 `--v2-*` 变量：`card` 做全窗主底、`sidebar` 做深底、`foreground` 做文字、`brand` 做强调色。
颜色值一字不改，主题设计成什么样，界面上就是什么样。背景图嵌入 data URL 铺满整窗（`html` 层），
全窗底色变量的 alpha 按主题 `surfaceAlpha`（默认 55%）改写，让背景图透出来。

**配方模式（6 套色相主题）**——主题只是一个色相配方（`themes/<id>.json` 里的 `hue`）。套用时收割
OpenCode **当下真实生效**的全部 CSS 变量计算值，保亮度/饱和度结构、整体换色相再注回去；
OpenCode 换自带主题后重跑一次即可跟随新底色。

开发中踩实并固化成代码规则与测试的三个坑：

1. **`--color-*` 命名空间绝不能回注**——那是 Tailwind 令牌层，OpenCode 用 `var()` 桥接到
   `--v2-*` 语义变量；回注字面量会把桥接冻死，界面整体变黑
2. **收割必须在干净状态**——皮肤在场时收割到的是染色后的值，染上再加染
3. **收割方向与主题深浅解耦**——OpenCode 的变量值按启动时的系统外观写死（运行时切
   `data-color-scheme` 不跟随），角色判定必须按变量名（`--v2-background-*`=底色、
   `--v2-text-*`=文字）而不是按值的亮暗猜

## 命令速查

| 命令 | 作用 |
|---|---|
| `bash use-skin.sh` | 交互菜单：选编号或名字切换主题 |
| `bash use-skin.sh <编号/名字/还原>` | 直接切换 / 还原 |
| `bash install-daemon.sh` | 安装守护进程：皮肤保活 + 恢复提醒 |
| `bash uninstall-daemon.sh` | 卸载守护进程 |
| `bash uninstall.sh` | 一键卸载：页面注入、守护进程、状态日志（`--purge` 连工具目录） |
| `bash apply-skin.sh` | 首次启用：带调试端口重启 OpenCode 并注入（端口丢失后也用它恢复） |
| `node skin.mjs list` | 列出全部主题 |
| `node skin.mjs status` | 端口 / 主窗口 / 皮肤状态 / 可见配色抽查 |
| `node skin.mjs inject --theme <id>` | 套用指定主题（默认 state 里的，再默认 deep-teal） |
| `node skin.mjs remove` | 只移除皮肤 |
| `node skin.mjs persistence on\|off` | 皮肤常驻开关（关=本次会话用完即止） |
| `node skin.mjs shot [文件]` | 截图当前窗口（验证用） |
| `npm test` | 跑测试套件（`node --test`，23 个用例，零依赖） |

## 皮肤守护进程

`install-daemon.sh` 安装的 LaunchAgent（`com.opencode.skin.daemon`）做两件事：

1. **皮肤保活**：每 5 秒巡检，OpenCode 刷新/重启后皮肤丢失 → 等应用自己的主题落定
   （AMOLED 等在启动数秒后才应用，抢跑会收割到默认 dark 底色）→ 重新注入
2. **恢复提醒**：OpenCode 被普通方式重启（调试端口消失）时弹 macOS 系统通知。
   守护进程**绝不主动重启 OpenCode**——重启只能由用户执行 `apply-skin.sh` 发起

多进程协调：CLI 换肤时写 `state.json` 的 `busyUntil` 置忙，守护进程看到就让行，
避免「CLI 刚移除皮肤 → 守护进程抢先注入 → CLI 收割到染色值」的双重染色竞态。

## 文件结构

```
opencode-skin/
├── use-skin.sh           # 日常入口（菜单实现在 lib/menu.mjs）
├── apply-skin.sh         # 首次启用：带端口重启 OpenCode + 注入
├── install-daemon.sh     # 装守护进程（LaunchAgent）
├── uninstall-daemon.sh   # 卸守护进程
├── uninstall.sh          # 一键卸载（--purge 连目录）
├── skin.mjs              # 注入器 CLI（list/status/inject/remove/persistence/shot）
├── daemon.mjs            # 守护进程：巡检保活 + 恢复提醒
├── lib/
│   ├── cdp.mjs           # CDP 客户端 + oc:// 主窗口识别
│   ├── palette.mjs       # 调色板映射表（ZC_TO_OC）+ 收割重映射（配方模式）
│   ├── tint.mjs          # 色彩数学 + 色相染色管线（纯函数）
│   ├── themes.mjs        # 主题加载（调色板 / 三色重映射 / 色相配方）
│   ├── core.mjs          # 等窗口/等DOM/等落定/收割/染色/注入（各入口共用）
│   ├── flow.mjs          # 入口级动作：串状态与注入 + busy 防抢占
│   ├── state.mjs         # state.json 读写（原子写）
│   └── menu.mjs          # use-skin.sh 交互菜单
├── test/                 # 测试套件（23 个用例，node --test）
├── themes/               # 28 套主题（一 JSON 一套 + 背景图目录）
└── logs/                 # 运行日志（已 gitignore）
```

## 做你自己的主题

往 `themes/` 扔一个 JSON 即可，无需重启任何东西：

**色相配方**（自适应当前底色）：

```json
{ "id": "my-tint", "name": "我的配方", "hue": 200 }
```

**调色板**（完整语义配色，背景图/渐变/纯色皆可）：

```json
{
  "id": "my-theme",
  "name": "我的主题",
  "appearance": "dark",
  "heroCss": "linear-gradient(160deg, #0d0620 0%, #071021 100%)",
  "colors": { "sidebar": "#0d071ef0", "card": "#221a3beb", "foreground": "#e9dcff", "brand": "#e879f9" }
}
```

- `heroImage` 指同目录背景图文件名（铺满整窗），`heroCss` 写任意 CSS 背景，都不写就是纯配色
- `colors` 键清单见 `lib/palette.mjs` 的 `ZC_TO_OC` 映射表，格式 `#RRGGBB` 或 `#RRGGBBAA`
- 背景图主题可加 `"surfaceAlpha": 0.55` 调图透出的程度（0~1，越小越透）

## 使用须知（都是实话）

- 注入走本机回环 CDP（`127.0.0.1:9345`），只覆盖 CSS 变量。该端口是 OpenCode 的调试端口，
  **没有身份认证**（CDP 协议本身如此）、只绑回环：同机同用户权限的进程都能连上它控制
  OpenCode 渲染进程。介意的话 `bash uninstall.sh` 后从启动台正常打开 OpenCode（端口消失，
  风险窗口关闭）。完整说明见 [SECURITY.md](SECURITY.md)
- OpenCode 换自带主题（如切到 AMOLED）后，调色板主题的观感保持不变（`!important` 锁定）；
  配方主题想跟随新底色重跑一次即可
- OpenCode 大版本更新若改了变量命名空间（`--v2-*` 等），映射表可能需要跟进；
  `node skin.mjs status` 可看皮肤是否还在生效
- 出问题先跑 `node skin.mjs status`：端口、主窗口、皮肤状态、可见配色抽查一屏可见

## 许可证与素材

代码使用 [MIT License](LICENSE)。该许可只覆盖软件代码，不授权角色、商标或第三方视觉素材——
内置动漫背景图版权归各自权利人，仅供个人使用。安全边界见 [SECURITY.md](SECURITY.md)，
更新历史见 [CHANGELOG.md](CHANGELOG.md)。

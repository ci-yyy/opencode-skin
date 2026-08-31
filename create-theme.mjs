#!/usr/bin/env node
// create-theme.mjs — 一张图片自动生成主题：取色 → 深浅判定 → 语义配色 → 写入 themes/
//
// 用法：
//   node create-theme.mjs --image /path/to/图.jpg --name "主题名"
//   node create-theme.mjs --image 图.png --name 名 --id my-id --appearance dark --force
//
// 取色在 OpenCode 渲染进程里跑（canvas 缩小采样 + 按色相分桶统计），
// 需要 OpenCode 带调试端口在运行（apply-skin.sh 启动的就是）。
// 生成的是调色板模式主题（完整语义 colors + 背景图），生成后立即出现在菜单里。
// 核心流程在 lib/create-theme.mjs（守护进程的面板上传共用同一套）。

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { createThemeFromImage } from "./lib/create-theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES_ROOT = join(here, "themes");

function parseArgs(argv) {
  const opts = { image: null, name: null, id: null, appearance: "auto", force: false, port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--image") opts.image = argv[++i];
    else if (a === "--name") opts.name = argv[++i];
    else if (a === "--id") opts.id = argv[++i];
    else if (a === "--appearance") opts.appearance = argv[++i];
    else if (a === "--force") opts.force = true;
    else if (a === "--port") opts.port = Number(argv[++i]);
    else throw new Error(`未知参数：${a}`);
  }
  if (!opts.image) throw new Error("需要 --image 指定图片路径");
  if (opts.appearance !== "auto" && opts.appearance !== "dark" && opts.appearance !== "light") {
    throw new Error("--appearance 只能是 auto / dark / light");
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 取色需要 OpenCode 渲染进程（canvas）
  const targets = await listTargets(opts.port, { timeoutMs: 3000 });
  const { target } = pickMainWindow(classifyTargets(targets));
  if (!target) throw new Error(`等不到 OpenCode 主窗口（端口 ${opts.port}）。先执行：bash ${join(here, "apply-skin.sh")}`);
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  let result;
  try {
    result = await createThemeFromImage({
      session,
      imagePath: opts.image,
      name: opts.name,
      id: opts.id,
      appearance: opts.appearance,
      force: opts.force,
      themesRoot: THEMES_ROOT,
    });
  } finally {
    session.close();
  }
  console.log(`✅ 主题「${result.name}」已生成：themes/${result.dir}/`);
  console.log(`   外观：${result.appearance === "dark" ? "🌙 深色" : "☀️ 浅色"} · 背景图已就位`);
  console.log(`   立即套用：bash ${join(here, "use-skin.sh")} ${result.name}`);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
});

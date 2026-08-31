#!/usr/bin/env node
// apply.mjs — 把主题注入正在运行的 OpenCode（前提：OpenCode 带 --remote-debugging-port=9345 启动）
//
// 用法：
//   node apply.mjs                          注入默认主题（state 里的，再默认 deep-teal）
//   node apply.mjs --theme origami          指定主题 ID
//   node apply.mjs --port 9345              指定 CDP 端口（默认 9345）
//   node apply.mjs --wait 60000             等主窗口出现的最长时间（毫秒）
//   node apply.mjs --dry-run                只打印生成的 CSS，不连接 OpenCode
//   node apply.mjs --status                 查看当前皮肤状态
//   node apply.mjs --list                   列出所有可用主题
//   node apply.mjs --remove                 移除皮肤，恢复官方外观

import { DEFAULT_PORT } from "./lib/cdp.mjs";
import { listThemes, loadTheme, DEFAULT_THEME_ID } from "./lib/themes.mjs";
import { readState, updateState } from "./lib/state.mjs";
import { buildSkinCss } from "./lib/tint.mjs";
import { buildPaletteCss } from "./lib/palette.mjs";
import { readFileSync } from "node:fs";
import { applyRecipe, injectionScript, removalScript, statusOfApp, waitForMainWindow, waitDomReady } from "./lib/core.mjs";
import { CdpSession } from "./lib/cdp.mjs";

const here = new URL(".", import.meta.url);

function parseArgs(argv) {
  const opts = {
    port: Number(process.env.OPENCODE_SKIN_CDP_PORT) || DEFAULT_PORT,
    theme: null,
    waitMs: 15000,
    status: false,
    list: false,
    dryRun: false,
    remove: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg === "--theme") opts.theme = argv[++i];
    else if (arg === "--wait") opts.waitMs = Number(argv[++i]);
    else if (arg === "--status") opts.status = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--remove") opts.remove = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isInteger(opts.port)) throw new Error("--port 需要一个整数");
  if (!Number.isInteger(opts.waitMs) || opts.waitMs < 0) throw new Error("--wait 需要一个非负整数（毫秒）");
  return opts;
}

async function listAllThemes() {
  const themes = await listThemes();
  console.log("可用主题（apply.mjs --theme <id>）：\n");
  themes.forEach((t, i) => {
    const type = t.mode === "palette"
      ? (t.kind === "image" ? "🖼 背景图" : t.kind === "gradient" ? "🎨 渐变" : "⬛ 纯色")
      : "🌊 色相";
    const appear = t.mode === "palette" ? (t.appearance === "light" ? "☀️" : "🌙") : "  ";
    console.log(`  ${String(i + 1).padStart(2)}. ${appear} ${t.name.padEnd(14)} ${type}  ${t.id}`);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    await listAllThemes();
    return;
  }

  if (opts.status) {
    const state = await readState();
    const s = await statusOfApp({ port: opts.port, waitMs: 3000 });
    console.log(JSON.stringify({ port: opts.port, state, app: s }, null, 2));
    return;
  }

  // 解析主题（inject / dry-run 共用）
  let theme = null;
  if (!opts.remove) {
    const themeId = opts.theme || (await readState()).theme || DEFAULT_THEME_ID;
    theme = await loadTheme(themeId).catch((e) => {
      throw new Error(`${e.message}（可用 node apply.mjs --list 查看）`);
    });
  }

  if (opts.dryRun) {
    // 直搬模式不依赖收割，直接生成；配方模式用空收割提示需连接
    if (theme.mode === "palette") {
      const { css, remapped } = await buildPaletteCss({}, theme);
      console.log(css);
      console.error(`\n（${remapped} 个变量，${theme.heroImageAbs || theme.heroCss ? "含背景层" : "纯配色"}）`);
    } else {
      console.error("配方模式需要连接 OpenCode 收割当前配色后才能生成 CSS（去掉 --dry-run 直接注入）");
      process.exitCode = 1;
    }
    return;
  }

  const target = await waitForMainWindow(opts.port, opts.waitMs);
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    await waitDomReady(session, opts.waitMs);

    if (opts.remove) {
      const result = await session.evaluate(removalScript());
      await updateState({ theme: null });
      console.log(result?.removed ? "✅ 皮肤已移除，恢复官方外观" : "ℹ️ 本来就没有皮肤");
      return;
    }

    const { result, tinted } = await applyRecipe(session, theme, { timeoutMs: opts.waitMs });
    if (!result?.applied) {
      throw new Error(`注入失败：${result?.notReady ? "页面未就绪" : result?.error || "无返回"}`);
    }
    await updateState({ theme: theme.id });
    console.log(`✅ 主题「${theme.name}」已注入`);
    console.log(`   目标窗口：${target.url}`);
    console.log(`   CSS 大小：${result.bytes} 字节`);
    console.log(`   抽检 --v2-background-bg-base = ${result.bgBase || "(空)"}`);
    console.log(`   抽检 --v2-blue-500 = ${result.accent || "(空)"}`);
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  if (/等不到|无法连接/.test(error.message)) {
    console.error(`   OpenCode 没带调试端口。首次使用请先执行：bash ${new URL("apply-skin.sh", here).pathname}`);
  }
  process.exitCode = 1;
});

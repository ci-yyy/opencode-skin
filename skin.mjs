#!/usr/bin/env node
// skin.mjs — 注入器 CLI
//
//   node skin.mjs list                    列出主题配方
//   node skin.mjs status                  端口 / 窗口 / 皮肤 / 状态 / 可见配色抽查
//   node skin.mjs inject [--theme id]     套用主题（默认 state 里的，再默认 deep-teal）
//   node skin.mjs remove                  移除皮肤，恢复官方外观
//   node skin.mjs persistence on|off      皮肤常驻开关（守护进程是否自动恢复）
//   node skin.mjs shot [文件.png]         截图当前窗口（验证用）
//   全局可选：--port 9345 --wait 15000

import { writeFileSync } from "node:fs";
import { DEFAULT_PORT, CdpSession } from "./lib/cdp.mjs";
import { listThemes, loadTheme, DEFAULT_THEME_ID } from "./lib/themes.mjs";
import { readState, updateState } from "./lib/state.mjs";
import { applyThemeById, restoreOfficial } from "./lib/flow.mjs";
import { statusOfApp, waitForMainWindow, waitDomReady } from "./lib/core.mjs";

function parseArgs(argv) {
  const opts = {
    port: Number(process.env.OPENCODE_SKIN_CDP_PORT) || DEFAULT_PORT,
    theme: null,
    waitMs: 15000,
    persistenceValue: null,
    shotFile: null,
  };
  const rest = [...argv];
  const cmd = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--theme") opts.theme = rest[++i];
    else if (a === "--port") opts.port = Number(rest[++i]);
    else if (a === "--wait") opts.waitMs = Number(rest[++i]);
    else if (cmd === "persistence" && (a === "on" || a === "off")) opts.persistenceValue = a === "on";
    else if (cmd === "shot" && !a.startsWith("--")) opts.shotFile = a;
    else throw new Error(`未知参数：${a}`);
  }
  if (!Number.isInteger(opts.port)) throw new Error("--port 需要一个整数");
  if (!Number.isInteger(opts.waitMs) || opts.waitMs < 0) throw new Error("--wait 需要一个非负整数（毫秒）");
  const CMDS = ["list", "status", "inject", "remove", "persistence", "shot"];
  if (!CMDS.includes(cmd)) {
    throw new Error(`未知命令：${cmd ?? "(空)"}（可用：${CMDS.join(" / ")}）`);
  }
  return { cmd, opts };
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));

  if (cmd === "list") {
    const themes = await listThemes();
    console.log("可用主题（use-skin.sh 菜单编号即此顺序）：\n");
    themes.forEach((t, i) => {
      const type = t.mode === "palette"
        ? (t.kind === "image" ? "🖼 背景图" : t.kind === "gradient" ? "🎨 渐变" : "⬛ 纯色")
        : "🌊 色相";
      const appear = t.mode === "palette" ? (t.appearance === "light" ? "☀️" : "🌙") : "  ";
      const detail = t.mode === "palette"
        ? `${t.palette.surface} / ${t.palette.text} / ${t.palette.accent}`
        : `色相 ${String(Math.round(t.hue)).padStart(3)}°`;
      console.log(`  ${String(i + 1).padStart(2)}. ${appear} ${t.name.padEnd(14)} ${type}  ${detail}  ${t.id}`);
    });
    return;
  }

  if (cmd === "status") {
    const state = await readState();
    const s = await statusOfApp({ port: opts.port, waitMs: 3000 });
    console.log(JSON.stringify({
      port: opts.port,
      state,
      app: s.portUp
        ? { portUp: true, window: s.window, ...s.health, sweep: s.sweep }
        : { portUp: false, error: s.error },
    }, null, 2));
    return;
  }

  if (cmd === "inject") {
    const themeId = opts.theme || (await readState()).theme || DEFAULT_THEME_ID;
    await loadTheme(themeId).catch((e) => { throw new Error(`${e.message}（可用 node skin.mjs list 查看）`); });
    const { result, tinted, recipe } = await applyThemeById(themeId, { port: opts.port, waitMs: opts.waitMs });
    console.log(`✅ 主题「${recipe.name}」已注入（染色 ${tinted} 个变量，CSS ${result.bytes} 字节）`);
    console.log(`   底色 --v2-background-bg-base = ${result.bgBase} · 强调 --v2-blue-500 = ${result.accent}`);
    return;
  }

  if (cmd === "remove") {
    const r = await restoreOfficial({ port: opts.port, waitMs: opts.waitMs });
    console.log(r?.removed ? "✅ 皮肤已移除，恢复官方外观" : "ℹ️ 本来就没有皮肤");
    return;
  }

  if (cmd === "persistence") {
    if (opts.persistenceValue === null) throw new Error("用法：node skin.mjs persistence on|off");
    const state = await updateState({ persistence: opts.persistenceValue });
    console.log(`✅ 皮肤常驻已${state.persistence ? "开启" : "关闭"}${state.persistence ? "" : "（本次会话继续用，OpenCode 下次启动恢复官方外观）"}`);
    return;
  }

  if (cmd === "shot") {
    const target = await waitForMainWindow(opts.port, opts.waitMs);
    const session = await new CdpSession(target.webSocketDebuggerUrl).open();
    try {
      await waitDomReady(session, 3000);
      const r = await session.send("Page.captureScreenshot", { format: "png" });
      const file = opts.shotFile || "shot.png";
      writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`截图已保存：${file}`);
    } finally {
      session.close();
    }
  }
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});

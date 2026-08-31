#!/usr/bin/env node
// lib/menu.mjs — 交互菜单（use-skin.sh 的实现）
//   bash use-skin.sh           交互菜单
//   bash use-skin.sh 3         按编号切换
//   bash use-skin.sh 樱雾粉     按名字切换（模糊匹配，忽略空格和中点）
//   bash use-skin.sh 还原       恢复官方外观
import readline from "node:readline/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "./cdp.mjs";
import { listThemes } from "./themes.mjs";
import { readState } from "./state.mjs";
import { applyThemeById, restoreOfficial } from "./flow.mjs";
import { hslToRgb } from "./tint.mjs";

const toolDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.OPENCODE_SKIN_CDP_PORT) || DEFAULT_PORT;

const normalize = (s) => String(s).toLowerCase().replace(/[\s·]/g, "");

function swatch(hue) {
  const [r, g, b] = hslToRgb(hue / 360, 0.5, 0.55);
  return `\x1b[48;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m   \x1b[0m`;
}

function swatchFromHex(hex) {
  const m = hex.match(/^#(..)(..)(..)$/);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return `\x1b[48;2;${r};${g};${b}m   \x1b[0m`;
}

function resolveChoice(input, themes) {
  const q = normalize(input);
  if (!q) return null;
  if (["还原", "恢复", "restore", "r", "0"].includes(q)) return { action: "restore" };
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return n >= 1 && n <= themes.length ? { action: "apply", theme: themes[n - 1] } : null;
  }
  const exact = themes.find((t) => normalize(t.id) === q || normalize(t.name) === q);
  if (exact) return { action: "apply", theme: exact };
  const fuzzy = themes.find((t) => normalize(t.name).includes(q) || normalize(t.id).includes(q));
  return fuzzy ? { action: "apply", theme: fuzzy } : null;
}

async function act(choice) {
  if (!choice) {
    console.log("没听懂，输入编号、主题名或「还原」");
    process.exitCode = 1;
    return;
  }
  try {
    if (choice.action === "restore") {
      const r = await restoreOfficial({ port, waitMs: 20000 });
      console.log(r?.removed ? "✅ 皮肤已移除，恢复官方外观" : "ℹ️ 本来就没有皮肤");
      return;
    }
    const { result, tinted, recipe } = await applyThemeById(choice.theme.id, { port, waitMs: 20000 });
    console.log(`✅ 已套用「${recipe.name}」（染色 ${tinted} 个变量，CSS ${result.bytes} 字节）`);
    console.log(`   底色 --v2-background-bg-base = ${result.bgBase} · 强调 --v2-blue-500 = ${result.accent}`);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    if (/等不到|无法连接/.test(e.message)) {
      console.error(`   OpenCode 没带调试端口。首次使用请先执行：bash ${join(toolDir, "apply-skin.sh")}`);
    }
    process.exitCode = 1;
  }
}

async function main() {
  const themes = await listThemes();
  const state = await readState();
  const arg = process.argv[2];
  if (arg) {
    await act(resolveChoice(arg, themes));
    return;
  }
  console.log("\nOpenCode 皮肤（主题配色直搬 + 色相染色，立即生效不重启）\n");
  themes.forEach((t, i) => {
    const mark = state.theme === t.id ? " ✓" : "";
    const appear = t.mode === "palette" ? (t.appearance === "light" ? "☀️" : "🌙") : "  ";
    // 直搬主题从 colors 取 brand 当色卡；三色主题取 palette.accent；配方用色相
    const chipHex = t.colors?.brand || t.palette?.accent || (t.mode === "palette" ? "#888888" : null);
    const chip = chipHex ? swatchFromHex(chipHex) : swatch(t.hue);
    console.log(`  ${String(i + 1).padStart(2)}. ${chip} ${appear} ${t.name}${mark}`);
  });
  console.log("   0. 还原官方外观");
  const current = state.theme ? (themes.find((t) => t.id === state.theme)?.name ?? state.theme) : "官方外观";
  console.log(`\n当前：${current} · 常驻：${state.persistence ? "开" : "关"}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("输入编号 / 主题名 / 还原：");
    await act(resolveChoice(answer, themes));
  } catch {
    // stdin 关闭（非交互管道）：静默退出
  } finally {
    rl.close();
  }
}

main();

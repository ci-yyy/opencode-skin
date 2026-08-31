import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaletteCss, remapValue } from "../lib/palette.mjs";

const DARK = { surface: "#080d10", text: "#d8eef0", accent: "#3fd6d0" };
const LIGHT = { surface: "#faf5ec", text: "#4a3f2f", accent: "#c08a2d" };

test("remapValue：surface 角色映深底、text 角色映亮字（深色主题），alpha 保留", () => {
  // 角色由变量名决定（与值亮暗无关）；收割值无论深浅模式，角色映射方向一致
  const bg = remapValue("#000000", { ...DARK, appearance: "dark" }, "surface");
  const bgFromLight = remapValue("#f1f1f1", { ...DARK, appearance: "dark" }, "surface");
  const fg = remapValue("#ffffff", { ...DARK, appearance: "dark" }, "text");
  const fgFromDark = remapValue("#1f1f1f", { ...DARK, appearance: "dark" }, "text");
  const num = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const [label, v] of [["深色收割的底", bg], ["浅色收割的底", bgFromLight]]) {
    const [r, g, b] = num(v);
    // 深色主题底带 L0.14~0.32，比纯黑亮但仍是深色
    assert.ok(r < 100 && g < 100 && b < 100, `${label}应映为深底（非纯黑），得到 ${v}`);
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    assert.ok(l >= 0.10 && l <= 0.36, `${label}亮度应落在观感带 0.10~0.36，得到 ${v} (L${l.toFixed(2)})`);
  }
  for (const [label, v] of [["深色收割的字", fg], ["浅色收割的字", fgFromDark]]) {
    const [r, g, b] = num(v);
    assert.ok(r > 150 && g > 150 && b > 150, `${label}应映为亮字，得到 ${v}`);
  }
  assert.ok(remapValue("#ffffff1a", { ...DARK, appearance: "dark" }, "surface").endsWith("1a"), "alpha 应保留");
});

test("remapValue：非颜色输入返回 null 而不是炸", () => {
  assert.equal(remapValue("var(--x)", { ...DARK, appearance: "dark" }), null);
  assert.equal(remapValue("0.25rem", { ...DARK, appearance: "dark" }), null);
});

test("remapValue：浅色主题 surface 映亮底、text 映深字（与收割方向无关）", () => {
  const bg = remapValue("#f1f1f1", { ...LIGHT, appearance: "light" }, "surface");
  const bgFromDark = remapValue("#0e0e0e", { ...LIGHT, appearance: "light" }, "surface");
  const fg = remapValue("#1f1f1f", { ...LIGHT, appearance: "light" }, "text");
  const num = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const [label, v] of [["浅色收割的底", bg], ["深色收割的底", bgFromDark]]) {
    const [r, g, b] = num(v);
    assert.ok(r > 180 && g > 170 && b > 140, `${label}应映为亮底，得到 ${v}`);
  }
  const [fr, fgr, fb] = num(fg);
  assert.ok(fr < 110 && fgr < 110 && fb < 110, `文字应映为深色，得到 ${fg}`);
});

test("buildPaletteCss：accent 变量用主题 accent、状态色放行、--color-* 排除", async () => {
  const theme = {
    mode: "palette",
    id: "test",
    name: "测试",
    appearance: "dark",
    palette: DARK,
    surfaceAlpha: 0.92,
    heroCss: "linear-gradient(160deg, #0d0620, #071021)",
  };
  const harvested = {
    vars: {
      "--v2-background-bg-base": "#000000",
      "--v2-background-bg-layer-01": "#030303",
      "--v2-text-text-base": "#ffffff",
      "--v2-blue-500": "#d1bcfe",
      "--v2-border-border-focus": "#cdbefb",
      "--v2-red-500": "#feb2b0",
      "--color-v2-grey-1100": "#000000",
    },
    htmlBg: "",
  };
  const { css, remapped } = await buildPaletteCss(harvested, theme);
  assert.ok(remapped >= 5, `重映射数量异常：${remapped}`);
  assert.ok(css.includes("--v2-blue-500: #3fd6d0"), "blue 系应映为主题 accent");
  assert.ok(css.includes("--v2-border-border-focus: #3fd6d0"), "focus 边框应映为主题 accent");
  assert.ok(!css.includes("--v2-red-500"), "状态色不应回注");
  assert.ok(!css.includes("--color-"), "--color-* 桥接层不应回注");
  assert.ok(css.includes("linear-gradient(160deg, #0d0620, #071021)"), "heroCss 应成为 html 背景");
  assert.ok(css.includes("color-scheme: dark"), "应声明 color-scheme");
  // 背景主题：主表层应带透明度（92%）
  const m = css.match(/--v2-background-bg-base: (#[0-9a-f]+)/);
  assert.ok(m && m[1].length === 9 && m[1].slice(7) === "eb", `主表层应有 92% 透明度，得到 ${m?.[1]}`);
});

test("buildPaletteCss：无 hero 时表层不加透明度", async () => {
  const theme = { mode: "palette", id: "t2", name: "t2", appearance: "dark", palette: DARK };
  const { css } = await buildPaletteCss({ vars: { "--v2-background-bg-base": "#000000" }, htmlBg: "" }, theme);
  const m = css.match(/--v2-background-bg-base: (#[0-9a-f]+)/);
  assert.ok(m && m[1].length === 7, `无背景主题表层应不透明，得到 ${m?.[1]}`);
  assert.ok(!css.includes("html {"), "无背景不应输出 html 规则");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColor, rgbToHsl, hslToRgb, tintValue, buildSkinCss, TINT_RE } from "../lib/tint.mjs";

const RECIPE = {
  id: "test",
  name: "测试",
  hue: 172,
  satCap: 0.38,
  greySat: 0.07,
  liftDark: { s: 0.38, l: 0.06 },
  liftThresholdL: 0.045,
};

test("parseColor 支持 hex / rgb / rgba 各格式", () => {
  assert.deepEqual(parseColor("#000000"), { r: 0, g: 0, b: 0, a: null });
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: null });
  assert.equal(parseColor("#ffffff80").a, 128);
  assert.deepEqual(parseColor("rgb(8, 8, 8)"), { r: 8, g: 8, b: 8, a: null });
  assert.equal(parseColor("rgba(0, 0, 0, 0)").a, 0);
  assert.equal(parseColor("rgb(255 255 255 / 50%)").a, 128);
  assert.equal(parseColor("var(--x)"), null);
  assert.equal(parseColor("4px"), null);
  assert.equal(parseColor(""), null);
  assert.equal(parseColor(null), null);
});

test("HSL 往返：rgbToHsl → hslToRgb 回到原色（±1）", () => {
  for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#d1bcfe", "#091514", "#fefefe", "#feb2b0"]) {
    const m = hex.match(/^#(..)(..)(..)$/);
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
    const { h, s, l } = rgbToHsl(r, g, b);
    const [r2, g2, b2] = hslToRgb(h, s, l);
    assert.ok(
      Math.abs(r - r2) <= 1 && Math.abs(g - g2) <= 1 && Math.abs(b - b2) <= 1,
      `${hex} 往返偏差过大：${[r2, g2, b2]}`,
    );
  }
});

test("近黑提升：纯黑染出带色底（AMOLED 场景），透明度保留", () => {
  const t = tintValue("#000000", RECIPE);
  const c = parseColor(t);
  assert.ok(c.g > 5 && c.b > 5, `纯黑应被提升为带色底，得到 ${t}`);
  assert.ok(c.g > c.r && c.b > c.r, `色相 172° 应偏青绿（绿蓝高于红），得到 ${t}`);
  const t2 = tintValue("#00000055", RECIPE);
  assert.ok(t2.length === 9 && t2.endsWith("55"), `透明度应保留在末两位，得到 ${t2}`);
});

test("白色保持近白，高亮彩色染色后仍明亮", () => {
  const w = parseColor(tintValue("#ffffff", RECIPE));
  assert.equal(w.r, 255); // l=1 时任何饱和度都是纯白
  const t = tintValue("#d1bcfe", RECIPE); // 原淡紫 s≈0.97 → 压到 satCap
  const c = parseColor(t);
  assert.ok(c.r > 200 && c.g > 200 && c.b > 200, `亮度 0.87 的颜色染色后应仍明亮，得到 ${t}`);
});

test("buildSkinCss：只回注被染色的变量，排除 --color-* 与非颜色", () => {
  const harvested = {
    vars: {
      "--v2-background-bg-base": "#000000",
      "--v2-grey-1100": "#000000",
      "--v2-blue-500": "#d1bcfe",
      "--v2-red-500": "#feb2b0",
      "--color-v2-background-bg-base": "#000000",
      "--spacing": "0.25rem",
    },
    htmlBg: "rgb(8, 8, 8)",
  };
  const { css, tinted } = buildSkinCss(harvested, RECIPE);
  assert.equal(tinted, 3);
  assert.ok(css.includes("--v2-background-bg-base:"));
  assert.ok(css.includes("--v2-grey-1100:"));
  assert.ok(css.includes("--v2-blue-500:"));
  assert.ok(!css.includes("--v2-red-500"), "状态色不应回注");
  assert.ok(!css.includes("--color-"), "--color-* 桥接层不应回注（回注会冻结 var() 桥接）");
  assert.ok(!css.includes("--spacing"), "非颜色变量不应回注");
  assert.ok(css.includes("html {"), "不透明的 html 背景应被染色覆盖");
  assert.ok(css.includes("!important"));
});

test("buildSkinCss：html 背景透明时不输出 html 规则", () => {
  const { css } = buildSkinCss({ vars: { "--v2-grey-1100": "#000000" }, htmlBg: "rgba(0, 0, 0, 0)" }, RECIPE);
  assert.ok(!css.includes("html {"));
});

test("buildSkinCss：收割值里混着非颜色时跳过而不是炸", () => {
  const { css, tinted } = buildSkinCss({
    vars: { "--v2-grey-1100": "#000000", "--v2-background-bg-base": "var(--oops)", "--v2-blue-500": "#d1bcfe" },
    htmlBg: "",
  }, RECIPE);
  assert.equal(tinted, 2);
  assert.ok(css.includes(":root"));
  assert.ok(!css.includes("--v2-background-bg-base:"));
});

test("TINT_RE 覆盖核心语义变量、放过状态色与排版变量", () => {
  const shouldTint = [
    "--v2-background-bg-base", "--v2-grey-1100", "--v2-text-text-base", "--v2-border-border-base",
    "--v2-icon-icon-base", "--v2-blue-500", "--v2-shadow-xs", "--v2-overlay-simple-overlay-hover",
    "--background-base", "--text-strong", "--border-base", "--surface-raised-base",
  ];
  const shouldNot = [
    "--v2-red-500", "--v2-green-500", "--v2-yellow-500", "--v2-state-fg-danger",
    "--accent", "--spacing", "--font-size-base", "--tw-translate-x",
  ];
  for (const n of shouldTint) assert.ok(TINT_RE.test(n), `${n} 应在染色名单`);
  for (const n of shouldNot) assert.ok(!TINT_RE.test(n), `${n} 不应在染色名单`);
});

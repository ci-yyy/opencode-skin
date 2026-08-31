// lib/tint.mjs — 色彩数学与染色管线（纯函数，无 CDP 依赖，可单测）
//
// 染色策略（原型实测验证过的三条铁律）：
//   1. 只回注「被染色」的变量，其余一概不碰——把收割值原样回注会冻结应用
//      运行时可变的变量（Tailwind 的 --tw-* 动画/位移等）
//   2. --color-* 命名空间绝不能回注：那是 Tailwind 令牌层，应用用 var() 桥接到
//      --v2-* 语义变量；回注字面量会把桥接冻死，界面整体变黑
//   3. AMOLED 纯黑（亮度≈0）染不出色相：近黑值提升为极暗的带色底，主题底色才显得出来
// 状态色（红/绿/黄）不在染色名单里，保持应用原值，避免「危险=绿色」这类语义错乱。

export const TINT_RE = /--v2-(grey|background|surface|text|border|icon|overlay|shadow|button|sidebar|card|popover|input|toast|menu|tab|tag|blue)-|--(background|text|border|surface|icon|button)-/;

export const DEFAULT_RECIPE = {
  satCap: 0.38,                     // 彩色变量染色后的饱和度上限（防荧光）
  greySat: 0.07,                    // 近灰变量的目标饱和度（给中性色一点主题色调）
  liftDark: { s: 0.38, l: 0.06 },   // 近黑值提升到的极暗带色底
  liftThresholdL: 0.045,            // 亮度低于此值视为「近黑」
};

export function parseColor(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : null;
    return { r, g, b, a };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)(%)?\s*[, ]\s*([\d.]+)(%)?\s*[, ]\s*([\d.]+)(%)?\s*(?:[,/]\s*([\d.]+)(%)?\s*)?\)$/i);
  if (m) {
    const ch = (i, pct) => Math.round(pct ? (parseFloat(m[i]) / 100) * 255 : parseFloat(m[i]));
    const r = ch(1, m[2]);
    const g = ch(3, m[4]);
    const b = ch(5, m[6]);
    let a = null;
    if (m[7] !== undefined) {
      const av = parseFloat(m[7]);
      const norm = m[8] ? av / 100 : av; // alpha 归一化到 0-1
      a = Math.round(Math.max(0, Math.min(1, norm)) * 255);
    }
    return { r, g, b, a };
  }
  return null;
}

function toHex(r, g, b, a) {
  const t = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return `#${t(r)}${t(g)}${t(b)}${a != null ? t(a) : ""}`;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

export function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

// 单值染色：保住原值的饱和度/亮度结构，色相换成配方色相；近黑走提升通道
export function tintValue(value, recipe) {
  const c = parseColor(value);
  if (!c) return null;
  const { s, l } = rgbToHsl(c.r, c.g, c.b);
  const hue = recipe.hue / 360;
  let ns;
  let nl;
  if (l < (recipe.liftThresholdL ?? DEFAULT_RECIPE.liftThresholdL)) {
    ns = recipe.liftDark?.s ?? DEFAULT_RECIPE.liftDark.s;
    nl = recipe.liftDark?.l ?? DEFAULT_RECIPE.liftDark.l;
  } else {
    ns = s >= 0.03 ? Math.min(s, recipe.satCap ?? DEFAULT_RECIPE.satCap) : (recipe.greySat ?? DEFAULT_RECIPE.greySat);
    nl = l;
  }
  const [r, g, b] = hslToRgb(hue, ns, nl);
  return toHex(r, g, b, c.a);
}

// 收割结果 + 配方 → 皮肤 CSS。
// harvest 形如 { vars: { "--v2-…": "#…" }, htmlBg: "rgb(8, 8, 8)" }（lib/core.mjs 的产物）
export function buildSkinCss(harvested, recipe) {
  const decls = [];
  let tinted = 0;
  const vars = harvested?.vars ?? {};
  for (const [name, raw] of Object.entries(vars)) {
    if (name.startsWith("--color-")) continue; // Tailwind 令牌桥接层，动了会冻结（原型实测）
    if (!TINT_RE.test(name)) continue;
    const t = tintValue(String(raw), recipe);
    if (!t) continue;
    decls.push(`  ${name}: ${t} !important;`);
    tinted++;
  }
  const parts = [
    `/* OpenCode Skin · ${recipe.name} · 色相 ${Math.round(recipe.hue)}° · 染色 ${tinted} 个变量 · 自动注入，手动修改会被覆盖 */`,
    `:root {\n${decls.join("\n")}\n}`,
  ];
  // AMOLED 等主题会给 <html> 直接写行内背景色，不吃变量；单独压一条（透明则不必）
  const htmlBg = harvested?.htmlBg;
  const bgParsed = htmlBg ? parseColor(htmlBg) : null;
  if (bgParsed && bgParsed.a !== 0) {
    parts.push(`html {\n  background-color: ${tintValue(htmlBg, recipe)} !important;\n}`);
  }
  return { css: parts.join("\n\n") + "\n", tinted };
}

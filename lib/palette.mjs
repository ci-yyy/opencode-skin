// lib/palette.mjs — 调色板模式：固定语义配色 + 可选背景图/渐变
//
// 与 lib/tint.mjs 的色相配方互补：
//   配方模式：保亮度结构、整体换色相（自适应任何底色主题）
//   调色板模式：把收割值按「暗面/亮面」角色重映射进主题调色板，
//               可带背景图/渐变（表层半透明透出背景）
//
// 映射规则（基于 AMOLED 收割实测的值分布）：
//   暗值（l<0.35，各背景层）    → 主题 surface 家族，保相对明度层次
//   亮值（l≥0.35，文字/图标/边框）→ 主题 text 家族，保 alpha（白底透明边框
//                                    #ffffff1a → text 色 1a 透明边框，结构不变）
//   blue 系 / border-focus      → 主题 accent（保 alpha）
//   状态色（red/green/yellow…）  → 不碰，保持应用原值
//   --color-*（Tailwind 桥接层） → 绝不回注（回注字面量会冻结桥接，实测界面变黑）

import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { TINT_RE, parseColor, rgbToHsl, hslToRgb } from "./tint.mjs";

export const ACCENT_RE = /-blue-|border-focus|icon-accent|text-accent/;
export const STATUS_RE = /--v2-(red|green|yellow|orange|pink|purple|state)-/;
// 变量名 → 界面角色（与收割时的深浅模式无关，名字本身稳定）
export const SURFACE_VAR_RE = /--v2-(grey|background|surface|overlay|sidebar|card|popover|input|toast|menu|tab|tag|button|border)-(?!text|fg|foreground)|--v2-shadow|--(background|surface|border)-/;
export const TEXT_VAR_RE = /--v2-(text|icon)-|--(text|icon)-/;

// 背景图支持的 MIME
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// 主表层变量：背景图/渐变主题里给这些变量加透明度，背景才能透出来
// bg-deep 是应用根容器的底色（铺满全窗），漏掉它背景图会被完全盖住
export const BG_LAYER_RE = /--v2-background-bg-(base|deep|layer-0[1-4]|button-neutral)$/;
export const LEGACY_BG_RE = /--(background|background-stronger)$/;

function withAlpha(hex, alpha255) {
  const c = parseColor(hex);
  const t = (x) => Math.round(x).toString(16).padStart(2, "0");
  return `#${t(c.r)}${t(c.g)}${t(c.b)}${t(alpha255)}`;
}

// 单值重映射。角色由调用方按变量名判定（SURFACE_VAR_RE / TEXT_VAR_RE），
// 与收割值当时的深浅模式无关——OpenCode 的变量值由 JS 按启动时的系统外观写死，
// 运行时切 data-color-scheme 不会跟着变，收割到浅色值时按亮度猜角色必错。
// rel（层次位置）用「值偏离中灰的程度」表达：越极端 = 越核心的底色/文字，
// 对深浅两种收割方向都成立。alpha 原样保留。
export function remapValue(value, palette, role = "surface") {
  const c = parseColor(value);
  const surface = parseColor(palette.surface);
  const text = parseColor(palette.text);
  if (!c || !surface || !text) return null;
  const lightTheme = palette.appearance === "light";
  const { l } = rgbToHsl(c.r, c.g, c.b);
  const sHsl = rgbToHsl(surface.r, surface.g, surface.b);
  const tHsl = rgbToHsl(text.r, text.g, text.b);
  const rel = clamp01(Math.abs(l - 0.5) * 2);
  let h, s, nl;
  if (role === "surface") {
    // 深色主题底色带：锚在 surface 明度的 1.5 倍（不足则 +0.11 保底），
    // 落在 L0.20 左右的观感带；上限夹 text 的 80% 保对比
    // 乘法对中灰底有效、加法对近黑底保底，上限夹 text 的 80% 保对比
    const sL = lightTheme
      ? clamp01(sHsl.l, 0.85, 0.98)                                        // 浅色主题：底要亮
      : clamp01(Math.max(sHsl.l * 1.5, sHsl.l + 0.11), 0.11, tHsl.l * 0.80); // 深色主题：×1.5 或 +0.11 取大
    nl = clamp01(sL * (0.85 + rel * 0.35));
    h = sHsl.h; s = sHsl.s;
  } else {
    const tL = lightTheme
      ? clamp01(tHsl.l, 0.15, 0.45)              // 浅色主题：文字要深
      : clamp01(tHsl.l, 0.55, 0.95);             // 深色主题：文字要亮
    nl = clamp01(tL * (0.85 + rel * 0.2));
    h = tHsl.h; s = tHsl.s;
  }
  const [r, g, b] = hslToRgb(h, s, nl);
  const t = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return `#${t(r)}${t(g)}${t(b)}${c.a != null ? t(c.a) : ""}`;
}

// 带上下限的夹取（旧签名 clamp01(x) 兼容：默认 0~1）
function clamp01(x, min = 0, max = 1) {
  return Math.max(min, Math.min(max, x));
}

// 主题 colors 语义键 → OpenCode 变量。调色板主题直接搬运用：
// 主题 JSON 带完整 colors 时按这张表逐键直译，不做任何亮度调整——所见即主题原设。
// 顺序即优先级：同一 OpenCode 变量被多个键映射时，先到的赢
// （card 优先于 sidebar：OpenCode 全窗主底对应内容区观感）
export const ZC_TO_OC = {
  card: "--v2-background-bg-base",             // 内容区卡片色做主底（比 sidebar 亮，观感不黑）
  cardSelected: "--v2-background-bg-layer-02",
  backgroundAlt: "--v2-background-bg-layer-01",
  sidebar: "--v2-background-bg-deep",
  panel: "--v2-background-bg-layer-02",
  header: "--v2-background-bg-layer-01",
  popover: "--v2-background-bg-layer-02",
  input: "--v2-background-bg-layer-01",
  inputFocused: "--v2-background-bg-layer-02",
  menu: "--v2-background-bg-layer-02",
  toast: "--v2-background-bg-layer-02",
  tooltip: "--v2-background-bg-layer-02",
  tabActive: "--v2-background-bg-layer-02",
  hover: "--v2-background-bg-layer-01",
  selected: "--v2-background-bg-layer-02",
  surface: "--v2-background-bg-layer-01",
  surfaceHover: "--v2-background-bg-layer-02",
  cardBorder: "--v2-border-border-base",
  border: "--v2-border-border-base",
  borderHover: "--v2-border-border-muted",
  inputBorder: "--v2-border-border-base",
  inputBorderHover: "--v2-border-border-muted",
  inputBorderFocused: "--v2-border-border-focus",
  popoverForeground: "--v2-text-text-base",
  foreground: "--v2-text-text-base",
  foregroundSubtle: "--v2-text-text-muted",
  foregroundSubtlest: "--v2-text-text-faint",
  foregroundInverse: "--v2-text-text-base",
  tooltipForeground: "--v2-text-text-base",
  terminalFg: "--v2-text-text-base",
  primary: "--v2-blue-500",
  brand: "--v2-blue-500",
  accent: "--v2-blue-500",
  secondary: "--v2-blue-400",
  primaryForeground: "--v2-grey-50",
  menuHover: "--v2-background-bg-layer-03",
  tag: "--v2-background-bg-layer-03",
  terminalBg: "--v2-background-bg-deep",
};

// 调色板主题 → 皮肤 CSS。
// 调色板主题 → 皮肤 CSS：theme.colors 完整时直接搬运，值一字不改保主题原设；
// 只给 palette 三色时走收割重映射兜底。
export async function buildPaletteCss(harvested, theme) {
  const built = theme.colors && Object.keys(theme.colors).length > 0
    ? buildDirectCss(theme)
    : await buildRemappedCss(harvested, theme);
  // 背景图/渐变挂在 html 上（两种模式共用）
  if (theme.heroImageAbs) {
    const mime = IMAGE_MIME[extname(theme.heroImageAbs).toLowerCase()];
    if (!mime) throw new Error(`背景图只支持 PNG/JPG/WebP：${theme.heroImageAbs}`);
    const buf = await readFile(theme.heroImageAbs);
    built.css += `html {\n  background: url("data:${mime};base64,${buf.toString("base64")}") center / cover no-repeat !important;\n}\n`;
  } else if (typeof theme.heroCss === "string" && theme.heroCss.trim()) {
    built.css += `html {\n  background: ${theme.heroCss.trim()} !important;\n}\n`;
  }
  return built;
}

// 直接搬运：colors 键 → OpenCode 变量。颜色值原样，唯一例外：
// hero 主题（背景图/渐变）里「铺满全窗」的底色变量——OpenCode 的全窗底色层
// 在 zcode 里只是局部卡片，原值 alpha（如 92%~96%）直搬会把背景图盖到只剩 8%。
// 深浅两套基准（实测 zcode 渲染：大面积区域直接透图，仅输入区实底）：
//   深色主题：统一改写为 surfaceAlpha（默认 55%），侧栏/内容区图可见度 ~45%
//   浅色主题：背景图偏亮，图上叠浅色底会发白发糊——降得更透（默认 30%），
//     让图主导观感，文字对比靠主题原配的深色文字色（对比度 20+）
function buildDirectCss(theme) {
  const hasHero = !!(theme.heroImageAbs || theme.heroCss);
  const light = theme.appearance === "light";
  const heroAlpha = theme.surfaceAlpha ?? (light ? 0.30 : 0.55);
  const decls = [];
  const seen = new Set();
  for (const [zcKey, ocVar] of Object.entries(ZC_TO_OC)) {
    const value = theme.colors[zcKey];
    if (typeof value !== "string" || !value.trim()) continue;
    if (seen.has(ocVar)) continue; // 先到的键优先（映射表已按优先级排序）
    seen.add(ocVar);
    let out = value.trim();
    if (hasHero && (BG_LAYER_RE.test(ocVar) || LEGACY_BG_RE.test(ocVar))) {
      out = withAlpha(out, Math.round(heroAlpha * 255));
    }
    decls.push([ocVar, out]);
  }
  const parts = [
    `/* OpenCode Skin · ${theme.name} · 主题配色直搬 ${decls.length} 个变量 · 自动注入，手动修改会被覆盖 */`,
    `:root {\n  color-scheme: ${theme.appearance === "light" ? "light" : "dark"} !important;\n${decls.map(([n, v]) => `  ${n}: ${v} !important;`).join("\n")}\n}`,
  ];
  return { css: parts.join("\n\n") + "\n", remapped: decls.length, direct: true };
}

// 旧路径：收割重映射（palette 三色模式）。主题只有 surface/text/accent 三色时用：
async function buildRemappedCss(harvested, theme) {
  const vars = harvested?.vars ?? {};
  const decls = [];
  let remapped = 0;
  for (const [name, raw] of Object.entries(vars)) {
    if (name.startsWith("--color-")) continue; // Tailwind 桥接层，冻结即全黑
    if (STATUS_RE.test(name)) continue;        // 状态色保持应用原值
    if (!TINT_RE.test(name)) continue;
    const value = String(raw);
    let out;
    if (ACCENT_RE.test(name)) {
      const c = parseColor(theme.palette.accent);
      const t = (x) => Math.round(x).toString(16).padStart(2, "0");
      const src = parseColor(value);
      out = c
        ? `#${t(c.r)}${t(c.g)}${t(c.b)}${src?.a != null ? t(src.a) : ""}`
        : null;
    } else {
      const role = SURFACE_VAR_RE.test(name) ? "surface" : TEXT_VAR_RE.test(name) ? "text" : null;
      if (!role) continue;
      out = remapValue(value, { ...theme.palette, appearance: theme.appearance }, role);
    }
    if (!out) continue;
    decls.push([name, out]);
    remapped++;
  }

  // 背景图/渐变主题：主表层加透明度透出背景
  const hasHero = !!(theme.heroImageAbs || theme.heroCss);
  if (hasHero) {
    const a = Math.round((theme.surfaceAlpha ?? 0.9) * 255);
    for (const [name, out] of decls) {
      if (BG_LAYER_RE.test(name) || LEGACY_BG_RE.test(name)) {
        const idx = decls.findIndex((d) => d[0] === name);
        decls[idx] = [name, withAlpha(out, a)];
      }
    }
  }

  const parts = [
    `/* OpenCode Skin · ${theme.name} · 调色板重映射 ${remapped} 个变量${hasHero ? " · 含背景层" : ""} · 自动注入，手动修改会被覆盖 */`,
    `:root {\n  color-scheme: ${theme.appearance === "light" ? "light" : "dark"} !important;\n${decls.map(([n, v]) => `  ${n}: ${v} !important;`).join("\n")}\n}`,
  ];
  return { css: parts.join("\n\n") + "\n", remapped };
}

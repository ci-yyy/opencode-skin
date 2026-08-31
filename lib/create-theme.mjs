// lib/create-theme.mjs — 图片 → 主题的核心流程（create-theme.mjs CLI 与守护进程上传共用）
// 取色在 OpenCode 渲染进程里跑（canvas 缩小采样 + 按色相分桶统计），
// 深浅判定 + 主色可读性校正 + 39 键语义配色 + 背景图落盘。

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { CdpSession } from "./cdp.mjs";

export const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function slugify(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || null;
}

// 渲染进程取色脚本：缩到 64px 采样 → 色相分桶 → 主色/辅色/平均色/亮度
function extractPaletteScript(dataUrl) {
  return `(async () => {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("图片解码失败"));
        img.src = ${JSON.stringify(dataUrl)};
      });
      const W = 64;
      const H = Math.max(1, Math.round(W * img.height / img.width));
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      const { data } = ctx.getImageData(0, 0, W, H);
      let totalL = 0, sr = 0, sg = 0, sb = 0, n = 0;
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        sr += r; sg += g; sb += b; n++;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        totalL += l;
        const d = max - min;
        if (d === 0) continue;
        const s = d / (1 - Math.abs(2 * l - 1));
        if (s < 0.18 || l < 0.12 || l > 0.92) continue;
        let h;
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        const key = Math.round(h / 30);
        const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, w: 0 };
        cur.r += r; cur.g += g; cur.b += b; cur.n += 1; cur.w += s;
        buckets.set(key, cur);
      }
      const toHex = (r, g, b) => "#" + [r, g, b].map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
      const ranked = [...buckets.values()].sort((a, b) => b.w - a.w);
      const accent = ranked[0] ? toHex(ranked[0].r / ranked[0].n, ranked[0].g / ranked[0].n, ranked[0].b / ranked[0].n) : "#38bdf8";
      const secondary = ranked[1] ? toHex(ranked[1].r / ranked[1].n, ranked[1].g / ranked[1].n, ranked[1].b / ranked[1].n) : accent;
      return { ok: true, accent, secondary, avg: toHex(sr / n, sg / n, sb / n), avgL: totalL / n };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  })()`;
}

// 色彩数学（与 lib/tint.mjs 同源，这里内联避免导出面膨胀）
function hexToRgb(hex) {
  const v = hex.replace("#", "").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
const mixHex = (a, b, t) => {
  const [r1, g1, b1] = hexToRgb(a); const [r2, g2, b2] = hexToRgb(b);
  const to = (x) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r1 + (r2 - r1) * t)}${to(g1 + (g2 - g1) * t)}${to(b1 + (b2 - b1) * t)}`;
};
const alphaHex = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  const to = (x) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}${to(a * 255)}`;
};
const darken = (h, t) => mixHex(h, "#000000", t);
const lighten = (h, t) => mixHex(h, "#ffffff", t);

// 主色可见度保障：保色相把明度搬进可读区间（深色主题主色 L0.52~0.72，浅色 0.30~0.48）
function ensureAccentVisible(accent, appearance) {
  const [r, g, b] = hexToRgb(accent);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
  }
  if (s < 0.45) s = Math.min(0.7, s + 0.25);
  let nl = l;
  if (appearance === "dark") nl = Math.min(0.72, Math.max(0.52, l));
  else nl = Math.min(0.48, Math.max(0.30, l));
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s;
  const p = 2 * nl - q;
  const to = (x) => Math.round(Math.max(0, Math.min(255, x * 255))).toString(16).padStart(2, "0");
  return `#${to(hue2rgb(p, q, h + 1 / 3) * 255)}${to(hue2rgb(p, q, h) * 255)}${to(hue2rgb(p, q, h - 1 / 3) * 255)}`;
}

// 4 色（accent/secondary/surface/text）→ 39 键语义 colors（与内置主题同结构）
function buildColors({ accent, secondary, surface, text }, appearance) {
  const dark = appearance !== "light";
  const card = dark ? lighten(surface, 0.06) : lighten(surface, 0.35);
  const deep = dark ? darken(surface, 0.35) : surface;
  const hex = (h) => h; // 已是 6 位
  if (!dark) {
    return {
      background: "#00000000", backgroundAlt: alphaHex(surface, 0.55), sidebar: alphaHex(surface, 0.97),
      panel: alphaHex(card, 0.97), header: alphaHex(surface, 0.97), card: alphaHex(card, 0.96),
      cardSelected: alphaHex(mixHex(surface, accent, 0.22), 0.96), cardBorder: alphaHex(accent, 0.22),
      popover: alphaHex(card, 0.98), popoverForeground: mixHex(text, "#000000", 0.1),
      input: alphaHex("#ffffff", 0.92), inputFocused: alphaHex("#ffffff", 0.97),
      inputBorder: alphaHex(accent, 0.35), inputBorderHover: alphaHex(accent, 0.6), inputBorderFocused: accent,
      border: alphaHex(text, 0.14), borderHover: alphaHex(text, 0.28), foreground: text,
      foregroundInverse: "#ffffff", foregroundSubtle: alphaHex(text, 0.62), foregroundSubtlest: alphaHex(text, 0.45),
      primary: accent, primaryForeground: "#ffffff", secondary: alphaHex(accent, 0.14),
      brand: accent, accent: alphaHex(accent, 0.12), hover: alphaHex(text, 0.07),
      selected: alphaHex(accent, 0.22), surface: alphaHex(accent, 0.07), surfaceHover: alphaHex(accent, 0.13),
      menu: alphaHex(card, 0.98), menuHover: alphaHex(accent, 0.16), toast: alphaHex(card, 0.98),
      tooltip: alphaHex(card, 0.98), tooltipForeground: mixHex(text, "#000000", 0.1),
      tag: alphaHex(accent, 0.16), tabActive: alphaHex(mixHex(surface, accent, 0.22), 0.95),
      terminalBg: alphaHex("#ffffff", 0.92), terminalFg: text,
    };
  }
  return {
    background: "#00000000", backgroundAlt: alphaHex(deep, 0.55), sidebar: alphaHex(deep, 0.94),
    panel: alphaHex(surface, 0.95), header: alphaHex(deep, 0.94), card: alphaHex(card, 0.92),
    cardSelected: alphaHex(mixHex(card, accent, 0.2), 0.94), cardBorder: alphaHex(accent, 0.26),
    popover: alphaHex(card, 0.97), popoverForeground: text,
    input: alphaHex(deep, 0.94), inputFocused: alphaHex(card, 0.96),
    inputBorder: alphaHex(accent, 0.3), inputBorderHover: alphaHex(accent, 0.55), inputBorderFocused: accent,
    border: alphaHex(text, 0.12), borderHover: alphaHex(text, 0.24), foreground: text,
    foregroundInverse: darken(surface, 0.5), foregroundSubtle: alphaHex(text, 0.6), foregroundSubtlest: alphaHex(text, 0.44),
    primary: accent, primaryForeground: darken(surface, 0.5), secondary: alphaHex(accent, 0.18),
    brand: accent, accent: alphaHex(accent, 0.16), hover: alphaHex(text, 0.08),
    selected: alphaHex(secondary, 0.28), surface: alphaHex(text, 0.05), surfaceHover: alphaHex(text, 0.1),
    menu: alphaHex(card, 0.97), menuHover: alphaHex(accent, 0.2), toast: alphaHex(card, 0.97),
    tooltip: alphaHex(card, 0.97), tooltipForeground: text,
    tag: alphaHex(secondary, 0.24), tabActive: alphaHex(mixHex(card, accent, 0.2), 0.94),
    terminalBg: alphaHex(deep, 0.95), terminalFg: text,
  };
}


// 从图片文件生成主题目录。session = 已连上 OpenCode 主窗口的 CdpSession。
// 返回 { dir, name, appearance }；失败抛错。
export async function createThemeFromImage({ session, imagePath, name, id, appearance = "auto", force = false, themesRoot }) {
  if (!existsSync(imagePath)) throw new Error(`图片不存在：${imagePath}`);
  const ext = extname(imagePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`只支持 PNG / JPG / WebP，收到：${ext || "（无后缀）"}`);
  if (appearance !== "auto" && appearance !== "dark" && appearance !== "light") {
    throw new Error("appearance 只能是 auto / dark / light");
  }
  const themeName = name || basename(imagePath, ext);
  // 名字能转成合法目录名就用它（重复生成 = 覆盖）；
  // 中文名等转不出来的，用图片内容哈希当目录名——同一张图重复上传幂等覆盖，
  // 不会像随机后缀那样越传越多
  const idFromName = id ? slugify(id) : slugify(themeName);
  const contentHash = createHash("sha1").update(await readFile(imagePath)).digest("hex").slice(0, 8);
  const themeId = idFromName || `custom-${contentHash}`;
  const destDir = join(themesRoot, themeId);
  if (existsSync(destDir) && !force) {
    throw new Error(`同名主题已存在：${themeId}（换个名字或 ID，或加 --force 覆盖）`);
  }

  const buf = await readFile(imagePath);
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const palette = await session.evaluate(extractPaletteScript(dataUrl));
  if (!palette?.ok) throw new Error(`取色失败：${palette?.error ?? "未知错误"}`);

  const finalAppearance = appearance === "auto"
    ? (palette.avgL < 0.45 ? "dark" : "light")
    : appearance;
  // 图片很暗/很亮时取出的主色会看不清（如深红按钮配黑字），
  // 保色相提亮/压深到安全区间后再参与映射
  const safeAccent = ensureAccentVisible(palette.accent, finalAppearance);
  const colors = buildColors({
    accent: safeAccent,
    secondary: palette.secondary,
    surface: finalAppearance === "dark" ? darken(palette.avg, 0.5) : lighten(palette.avg, 0.6),
    text: finalAppearance === "dark" ? lighten(palette.avg, 0.82) : darken(palette.avg, 0.74),
  }, finalAppearance);

  const heroFile = `hero${ext}`;
  await mkdir(destDir, { recursive: true });
  await copyFile(imagePath, join(destDir, heroFile));

  const theme = {
    mode: "palette",
    id: themeId,
    name: themeName,
    appearance: finalAppearance,
    surfaceAlpha: 0.55,
    heroImage: heroFile,
    colors,
    autoGenerated: { source: basename(imagePath), palette, avgL: Number(palette.avgL.toFixed(3)) },
  };
  await writeFile(join(destDir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");
  await writeFile(join(themesRoot, `${themeId}.json`), JSON.stringify(theme, null, 2) + "\n");
  return { dir: themeId, name: themeName, appearance: finalAppearance };
}

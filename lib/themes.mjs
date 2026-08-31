// lib/themes.mjs — 主题加载：两种模式
//   配方模式（mode: "recipe"）：色相染色，自适应当前底色（themes/<id>.json 里就一个 hue）
//   调色板模式（mode: "palette"）：固定语义配色 + 可选背景图/渐变
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RECIPE } from "./tint.mjs";

const THEMES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "themes");

export const DEFAULT_THEME_ID = "deep-teal";

export async function listThemes() {
  const files = (await readdir(THEMES_ROOT)).filter((f) => f.endsWith(".json")).sort();
  const themes = [];
  for (const f of files) {
    try {
      themes.push(await loadTheme(f.replace(/\.json$/, "")));
    } catch {
      // 无效主题跳过，不让一个坏文件拖垮整个菜单
    }
  }
  return themes;
}

export async function loadTheme(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`非法主题 ID：${id}`);
  }
  let theme;
  try {
    theme = JSON.parse(await readFile(join(THEMES_ROOT, `${id}.json`), "utf8"));
  } catch {
    throw new Error(`主题不存在或无法解析：${id}`);
  }
  if (theme.id !== id) throw new Error(`主题文件 id（${theme.id}）与文件名（${id}）不一致`);
  if (!theme.name || typeof theme.name !== "string") throw new Error(`主题 ${id} 缺少 name`);

  if (theme.mode === "palette") {
    if (theme.appearance !== "dark" && theme.appearance !== "light") {
      throw new Error(`主题 ${id} 的 appearance 只能是 dark 或 light`);
    }
    // 背景图路径解析成绝对路径（注入时读文件）
    if (theme.heroImage) {
      theme.heroImageAbs = join(THEMES_ROOT, id, theme.heroImage);
    }
    theme.kind = theme.heroImageAbs ? "image" : theme.heroCss ? "gradient" : "plain";
    // 直搬模式：colors 是完整语义配色（39 键），
    // 值必须都是 #RRGGBB / #RRGGBBAA
    if (theme.colors && Object.keys(theme.colors).length > 0) {
      const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
      for (const [k, v] of Object.entries(theme.colors)) {
        if (typeof v !== "string" || !HEX.test(v.trim())) {
          throw new Error(`主题 ${id} 的 colors.${k} 必须是 #RRGGBB(AA) 格式，收到：${v}`);
        }
      }
    } else if (!theme.palette) {
      throw new Error(`调色板主题 ${id} 需要 colors（直搬）或 palette（三色重映射）`);
    } else {
      for (const key of ["surface", "text", "accent"]) {
        if (!/^#[0-9a-f]{6}$/i.test(theme.palette[key] || "")) {
          throw new Error(`调色板主题 ${id} 的 palette.${key} 必须是 #RRGGBB`);
        }
      }
    }
    return theme;
  }

  // 配方模式（默认）
  if (!Number.isFinite(theme.hue) || theme.hue < 0 || theme.hue > 360) {
    throw new Error(`主题 ${id} 的 hue 必须是 0~360 的数字`);
  }
  theme.mode = "recipe";
  theme.kind = "tint";
  return { ...DEFAULT_RECIPE, ...theme };
}

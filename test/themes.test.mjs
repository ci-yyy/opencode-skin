import { test } from "node:test";
import assert from "node:assert/strict";
import { listThemes, loadTheme, DEFAULT_THEME_ID } from "../lib/themes.mjs";
import { buildSkinCss } from "../lib/tint.mjs";

test("全部主题合法且 id 唯一（配方+调色板混合）", async () => {
  const themes = await listThemes();
  assert.ok(themes.length >= 6, `应有至少 6 套主题，实际 ${themes.length}`);
  const ids = themes.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "id 不应重复");
  const recipes = themes.filter((t) => t.mode === "recipe");
  assert.ok(recipes.length >= 6, `配方主题应至少 6 套，实际 ${recipes.length}`);
  for (const t of recipes) {
    assert.ok(t.hue >= 0 && t.hue <= 360, `${t.id} hue 越界：${t.hue}`);
    assert.ok(t.satCap > 0 && t.satCap < 1, `${t.id} satCap 异常`);
    assert.ok(t.liftDark.l > 0 && t.liftDark.l < 0.2, `${t.id} liftDark.l 异常`);
  }
  for (const t of themes) {
    assert.ok(t.name, `${t.id} 缺 name`);
    assert.ok(["tint", "image", "gradient", "plain"].includes(t.kind), `${t.id} kind 异常：${t.kind}`);
  }
  assert.ok(ids.includes(DEFAULT_THEME_ID), `默认主题 ${DEFAULT_THEME_ID} 应存在`);
});

test("loadTheme 拒绝路径穿越 / 非法 id / 不存在的主题", async () => {
  await assert.rejects(() => loadTheme("../secret"));
  await assert.rejects(() => loadTheme("no-such-theme"));
  await assert.rejects(() => loadTheme(""));
  await assert.rejects(() => loadTheme("带空格的名字"));
});

test("每套配方都能对样例收割值生成皮肤 CSS", async () => {
  const harvested = {
    vars: { "--v2-background-bg-base": "#000000", "--v2-grey-1100": "#101010", "--v2-blue-500": "#d1bcfe" },
    htmlBg: "rgb(8, 8, 8)",
  };
  for (const t of await listThemes()) {
    const { css, tinted } = buildSkinCss(harvested, t);
    assert.ok(tinted >= 3, `${t.id} 染色数量异常：${tinted}`);
    assert.ok(css.includes(":root"), `${t.id} 缺 :root 块`);
    assert.ok(css.includes(t.name), `${t.id} 头部应带主题名`);
  }
});

test("不同配方对同一收割值染出不同底色", async () => {
  const harvested = { vars: { "--v2-grey-1100": "#000000" }, htmlBg: "" };
  const [amber, teal] = await Promise.all([loadTheme("amber-glow"), loadTheme("deep-teal")]);
  const a = buildSkinCss(harvested, amber).css.match(/--v2-grey-1100: (#[0-9a-f]+)/)[1];
  const b = buildSkinCss(harvested, teal).css.match(/--v2-grey-1100: (#[0-9a-f]+)/)[1];
  assert.notEqual(a, b, "琥珀(36°)与深海青(172°)对同一近黑值应染出不同颜色");
});

test("调色板主题全部合法（22 套）", async () => {
  const themes = await listThemes();
  const palettes = themes.filter((t) => t.mode === "palette");
  assert.equal(palettes.length, 22, `应有 22 套移植主题，实际 ${palettes.length}`);
  const withImage = palettes.filter((t) => t.kind === "image");
  const withGradient = palettes.filter((t) => t.kind === "gradient");
  assert.equal(withImage.length, 14, `背景图主题应 14 套，实际 ${withImage.length}`);
  assert.ok(withGradient.length >= 8, `渐变主题应至少 8 套，实际 ${withGradient.length}`);
  for (const t of palettes) {
    // 直搬模式：完整 colors 原样在场，值都是 #RRGGBB(AA)（loadTheme 已校验，这里再抽验）
    assert.ok(t.colors && Object.keys(t.colors).length >= 30, `${t.id} 的 colors 应为完整语义配色`);
    assert.match(t.colors.sidebar, /^#[0-9a-f]{6,8}$/i);
    assert.match(t.colors.card, /^#[0-9a-f]{6,8}$/i);
    assert.match(t.colors.foreground, /^#[0-9a-f]{6,8}$/i);
    if (t.kind === "image") {
      const { access } = await import("node:fs/promises");
      await access(t.heroImageAbs); // 背景图文件必须真实存在
    }
  }
});

test("调色板与配方两种模式都能生成 CSS", async () => {
  const harvested = { vars: { "--v2-background-bg-base": "#000000", "--v2-text-text-base": "#ffffff", "--v2-blue-500": "#d1bcfe" }, htmlBg: "" };
  const palette = await loadTheme("wuthering-tide");
  const { buildPaletteCss } = await import("../lib/palette.mjs");
  const built = await buildPaletteCss(harvested, palette);
  assert.ok(built.remapped >= 10, `直搬变量数异常：${built.remapped}`);
  assert.ok(built.css.includes("data:image/webp;base64,"), "鸣潮声骸的背景图应嵌入为 data URL");
  // 直搬核心：颜色原样，仅 hero 主题的全窗底色变量按 surfaceAlpha 改写 alpha
  // （主题原值的高 alpha 是按局部卡片设计的，铺全窗会盖死背景图）
  assert.ok(built.css.includes(palette.colors.foreground), "foreground 原色应原样直搬");
  const sidebarRgb = palette.colors.sidebar.slice(0, 7); // 去 alpha 的 RGB 部分
  assert.ok(built.css.includes(sidebarRgb), `sidebar 的 RGB 应原样直搬（alpha 可改写）：${sidebarRgb}`);
});

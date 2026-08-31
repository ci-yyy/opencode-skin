// lib/core.mjs — 注入核心：等窗口 / 等 DOM / 等主题落定 / 收割 / 染色 / 注入 / 移除
// skin.mjs（CLI）、menu.mjs（菜单）、daemon.mjs（守护进程）共用，保证各入口行为完全一致。

import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./cdp.mjs";
import { buildSkinCss } from "./tint.mjs";
import { buildPaletteCss } from "./palette.mjs";

export const STYLE_ID = "opencode-skin-style";

export function domReadyScript() {
  return `(() => { try { return !!(document && (document.head || document.documentElement)); } catch { return false; } })()`;
}

export function removalScript() {
  return `(() => {
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    if (!style) return { removed: false };
    style.remove();
    return { removed: true };
  })()`;
}

// 幂等注入：先删旧的同名 <style> 再插入新的，重复执行不会叠加
export function injectionScript(css, themeId) {
  return `(() => {
    try {
      if (typeof document === "undefined" || !(document.head || document.documentElement)) {
        return { applied: false, notReady: true };
      }
      const root = document.head || document.documentElement;
      const previous = document.getElementById(${JSON.stringify(STYLE_ID)});
      if (previous) previous.remove();
      const style = document.createElement("style");
      style.id = ${JSON.stringify(STYLE_ID)};
      style.setAttribute("data-opencode-skin", ${JSON.stringify(themeId)});
      style.textContent = ${JSON.stringify(css)};
      root.appendChild(style);
      const cs = getComputedStyle(document.documentElement);
      return {
        applied: true,
        bytes: ${css.length},
        bgBase: cs.getPropertyValue("--v2-background-bg-base").trim(),
        accent: cs.getPropertyValue("--v2-blue-500").trim(),
      };
    } catch (error) {
      return { applied: false, error: String(error) };
    }
  })()`;
}

export function healthScript() {
  return `(() => {
    try {
      if (typeof document === "undefined" || !(document.head || document.documentElement)) return { notReady: true };
      const style = document.getElementById(${JSON.stringify(STYLE_ID)});
      return {
        skin: !!style,
        skinThemeId: style ? style.getAttribute("data-opencode-skin") : null,
        themeAttr: document.documentElement.getAttribute("data-theme") || "",
      };
    } catch (error) {
      return { notReady: true, error: String(error) };
    }
  })()`;
}

// 主题落定探针：data-theme 属性 + 几个关键变量的当前值（waitForSettled 用其签名判稳）
function probeScript() {
  return `(() => {
    try {
      const de = document.documentElement;
      if (!(document.head || de)) return { domReady: false };
      const cs = getComputedStyle(de);
      return {
        domReady: true,
        themeAttr: de.getAttribute("data-theme") || "",
        bgBase: cs.getPropertyValue("--v2-background-bg-base").trim(),
        blue500: cs.getPropertyValue("--v2-blue-500").trim(),
        grey1100: cs.getPropertyValue("--v2-grey-1100").trim(),
        htmlBg: cs.backgroundColor,
      };
    } catch (e) {
      return { domReady: false };
    }
  })()`;
}

// 收割：枚举 documentElement 计算样式里的全部自定义属性（计算值已把 var() 解析成字面量）
function harvestScript() {
  return `(() => {
    try {
      const de = document.documentElement;
      if (!(document.head || de)) return { notReady: true };
      const cs = getComputedStyle(de);
      const vars = {};
      for (let i = 0; i < cs.length; i++) {
        const name = cs[i];
        if (typeof name === "string" && name.startsWith("--")) {
          const v = cs.getPropertyValue(name).trim();
          if (v) vars[name] = v;
        }
      }
      return { ok: true, themeAttr: de.getAttribute("data-theme") || "", htmlBg: cs.backgroundColor, vars };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`;
}

// 可见元素配色抽查（status 命令用）：窗口 5 个方位找第一个不透明背景，统计分布
export function sweepScript() {
  return `(() => {
    const W = innerWidth, H = innerHeight;
    const pts = [[0.06, 0.5], [0.5, 0.08], [0.5, 0.5], [0.5, 0.92], [0.94, 0.5]];
    const stats = {};
    let painted = 0;
    for (const [fx, fy] of pts) {
      const el = document.elementFromPoint(W * fx, H * fy);
      if (!el) continue;
      let n = el;
      for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) {
          stats[c] = (stats[c] || 0) + 1;
          painted++;
          break;
        }
      }
    }
    return { painted, distribution: stats };
  })()`;
}

export async function waitForMainWindow(port, waitMs) {
  const deadline = Date.now() + waitMs;
  let lastPages = [];
  while (Date.now() < deadline) {
    try {
      lastPages = classifyTargets(await listTargets(port, { timeoutMs: 1500 }));
      const { target } = pickMainWindow(lastPages);
      if (target) return target;
    } catch {
      // 端口还没起来（OpenCode 正在启动），继续等
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const seen = lastPages.length
    ? lastPages.map((p) => `  [${p.kind}] ${p.url}`).join("\n")
    : "  （没看到任何页面，可能端口没开或 OpenCode 没启动）";
  throw new Error(`等不到 OpenCode 主窗口（端口 ${port}）。看到的页面：\n${seen}`);
}

// 窗口出现 ≠ 页面就绪：刚启动时窗口目标已列出但 DOM 还没解析，直接注入会炸
export async function waitDomReady(session, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      if (await session.evaluate(domReadyScript())) return true;
    } catch {
      // 连接闪断（页面导航中），继续等
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// 等应用自己的主题落定：OpenCode 启动后要过几秒才把用户主题（如 AMOLED）应用到位
// （data-theme 属性出现、关键变量停止变化）。抢跑会收割到默认 dark 的值，
// 染出来的底色就不对了。签名稳定 + data-theme 在场（或更长的稳定期）才算落定。
export async function waitForSettled(session, { timeoutMs = 15000, stableMs = 2500 } = {}) {
  const sig = (p) => [p.domReady, p.themeAttr, p.bgBase, p.blue500, p.grey1100, p.htmlBg].join("|");
  const start = Date.now();
  let lastSig = null;
  let lastChange = start;
  let probe = null;
  while (Date.now() - start < timeoutMs) {
    try {
      probe = await session.evaluate(probeScript());
      const s = sig(probe);
      if (s !== lastSig) {
        lastSig = s;
        lastChange = Date.now();
      }
      const stableFor = Date.now() - lastChange;
      if (probe.themeAttr && stableFor >= stableMs) return probe;
      if (!probe.themeAttr && stableFor >= stableMs + 2000) return probe;
    } catch {
      // 页面导航中，继续等
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return probe;
}

export async function harvest(session) {
  const h = await session.evaluate(harvestScript());
  if (!h || h.notReady) throw new Error("页面未就绪，收割失败");
  if (!h.ok) throw new Error(`收割失败：${h.error}`);
  return h;
}

// 完整套用：先移除旧皮肤（收割必须在干净状态，否则读到的是染色后的值）→
// 等主题落定 → 收割 → 按配方染色 → 注入
export async function applyRecipe(session, recipe, opts = {}) {
  await session.evaluate(removalScript());
  await waitForSettled(session, opts);
  // 调色板主题固定深浅外观：收割前把应用切到主题的 appearance，
  // 否则「深色主题 × 浅色收割值」或反之，重映射方向全错
  // （OpenCode 跟随系统外观，用户系统是浅色时 data-color-scheme=light）
  if (recipe.mode === "palette") {
    const target = recipe.appearance === "light" ? "light" : "dark";
    await session.evaluate(`(() => {
      document.documentElement.setAttribute("data-color-scheme", ${JSON.stringify(target)});
    })()`);
    await new Promise((r) => setTimeout(r, 600));
  }
  const h = await harvest(session);
  const built = recipe.mode === "palette"
    ? await buildPaletteCss(h, recipe)
    : buildSkinCss(h, recipe);
  const result = await session.evaluate(injectionScript(built.css, recipe.id));
  return { result, tinted: built.remapped ?? built.tinted, themeAttr: h.themeAttr };
}

export async function injectToApp(recipe, { port = DEFAULT_PORT, waitMs = 15000 } = {}) {
  const target = await waitForMainWindow(port, waitMs);
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    await waitDomReady(session, waitMs);
    const { result, tinted } = await applyRecipe(session, recipe);
    if (!result?.applied) {
      throw new Error(`注入失败：${result?.notReady ? "页面未就绪" : result?.error || "无返回"}`);
    }
    return { result, tinted, target };
  } finally {
    session.close();
  }
}

export async function removeFromApp({ port = DEFAULT_PORT, waitMs = 15000 } = {}) {
  const target = await waitForMainWindow(port, waitMs);
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    return await session.evaluate(removalScript());
  } finally {
    session.close();
  }
}

export async function statusOfApp({ port = DEFAULT_PORT, waitMs = 3000 } = {}) {
  try {
    const target = await waitForMainWindow(port, waitMs);
    const session = await new CdpSession(target.webSocketDebuggerUrl).open();
    try {
      await waitDomReady(session, 3000);
      const health = await session.evaluate(healthScript());
      const sweep = await session.evaluate(sweepScript()).catch(() => null);
      return { portUp: true, window: target.url, health, sweep };
    } finally {
      session.close();
    }
  } catch (e) {
    return { portUp: false, error: e.message };
  }
}

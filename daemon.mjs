#!/usr/bin/env node
// daemon.mjs — 皮肤守护进程（launchd 管理，install-daemon.sh 安装）
//
// 职责：
//   1. 本地 HTTP 服务（127.0.0.1:9346）：供 OpenCode 界面里的「🎨 主题中心」面板
//      取主题列表 / 取主题 CSS / 上报切换 / 上传图片建主题 / 读写设置开关
//      （路由实现在 lib/http-api.mjs，这里只负责装配和生命周期）
//   2. 巡检（每 5 秒，受「皮肤常驻」开关控制）：OpenCode 刷新/重启后
//      皮肤 <style> 丢了补皮肤、主题中心按钮丢了补面板
//   3. 端口探测：OpenCode 被普通方式重启（调试端口消失）时发 macOS 系统通知。
//      守护进程绝不主动重启 OpenCode——重启必须由用户执行 apply-skin.sh 发起
//   4. busy 让行：CLI 正在换肤（state.busyUntil 未过期）时跳过注入，避免双重染色
//
// 手动前台调试：node daemon.mjs --foreground
// 端口可用环境变量覆盖（测试场景）：OPENCODE_SKIN_CDP_PORT / OPENCODE_SKIN_API_PORT

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { readState, updateState } from "./lib/state.mjs";
import { loadTheme, listThemes as listThemeMetas } from "./lib/themes.mjs";
import { buildPaletteCss } from "./lib/palette.mjs";
import { createThemeFromImage } from "./lib/create-theme.mjs";
import { STYLE_ID, PANEL_LAUNCHER_ID, applyRecipe, healthScript, panelInjectionScript } from "./lib/core.mjs";
import { createRequestHandler } from "./lib/http-api.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES_ROOT = join(here, "themes");
const PANEL_SOURCE = readFileSync(join(here, "lib", "panel.js"), "utf8");
const CDP_PORT = Number(process.env.OPENCODE_SKIN_CDP_PORT) || DEFAULT_PORT; // OpenCode 的 CDP 端口（默认 9345）
const API_PORT = Number(process.env.OPENCODE_SKIN_API_PORT) || 9346;        // 面板数据服务端口（默认 9346）
const POLL_MS = 5000;
const LOG_MAX_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 上传图片上限 12MB（足够当壁纸）
const APP_PROCESS = "OpenCode.app/Contents/MacOS/OpenCode"; // 只匹配主进程，不含 Helper

// ---------- 日志 ----------
const LOG_FILE = join(here, "logs", "daemon.log");
mkdirSync(join(here, "logs"), { recursive: true });
function log(msg) {
  try {
    // 简单轮转：超限改名为 .1（覆盖旧备份），日志目录最多 2 MiB 左右
    if (statSync(LOG_FILE).size > LOG_MAX_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // 文件还不存在（首次写入）或 rename 竞争失败，直接照常追加
  }
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(LOG_FILE, line + "\n");
  // launchd 场景下 stdout 没人看；只有前台调试时才打印
  if (process.argv.includes("--foreground")) process.stdout.write(line + "\n");
}

// ---------- CDP 会话缓存 ----------
// 巡检每 5 秒一次，每次新建 WebSocket 再关掉既浪费也刷日志。
// 以 webSocketDebuggerUrl 为键缓存；不可用（页面刷新/关闭）就换新。
let cachedSession = null;
let cachedUrl = null;
function discardCachedSession() {
  if (cachedSession) {
    try { cachedSession.close(); } catch {}
  }
  cachedSession = null;
  cachedUrl = null;
}
async function withMainWindow(target, fn) {
  if (!cachedSession || cachedUrl !== target.webSocketDebuggerUrl || !cachedSession.isOpen()) {
    discardCachedSession();
    cachedSession = await new CdpSession(target.webSocketDebuggerUrl).open();
    cachedUrl = target.webSocketDebuggerUrl;
  }
  try {
    return await fn(cachedSession);
  } catch (error) {
    // 命令失败多半是连接死了（页面刷新），丢弃缓存，下轮重连
    discardCachedSession();
    throw error;
  }
}

// 当前窗口目标（API 路由用；没有窗口时抛错由路由转 500）
async function requireMainWindow() {
  const targets = await listTargets(CDP_PORT, { timeoutMs: 2000 });
  const { target } = pickMainWindow(classifyTargets(targets));
  if (!target) throw new Error("OpenCode 主窗口不可达");
  return target;
}

// ---------- 主题工具（供 API） ----------
// 面板色卡：4 个代表色
function pickSwatches(theme) {
  if (theme.mode !== "palette" || !theme.colors) return null;
  const picks = [theme.colors.brand, theme.colors.primary, theme.colors.card, theme.colors.sidebar];
  const out = picks.filter(Boolean).map((c) => c.slice(0, 7)).slice(0, 4);
  return out.length ? out : null;
}

async function listThemesMeta() {
  const themes = await listThemeMetas();
  return themes.map((t) => ({
    dir: t.id,
    name: t.name || t.id,
    appearance: t.appearance === "light" ? "light" : "dark",
    kind: t.mode === "palette" ? t.kind : "tint",
    swatches: pickSwatches(t),
  }));
}

async function buildCssForDir(dir) {
  const theme = await loadTheme(dir);
  const { css } = await buildPaletteCss({}, theme);
  return { theme, css };
}

// ---------- 系统通知 / 进程探测 ----------
let lastNotifyTime = 0;
function notify(title, message) {
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
  spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
}
function appRunning() {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", APP_PROCESS], (error, stdout) => {
      resolve(!error && String(stdout).trim().length > 0);
    });
  });
}
async function notifyPortMissing() {
  const now = Date.now();
  if (now - lastNotifyTime < 10 * 60 * 1000) return; // 10 分钟内不重复弹
  lastNotifyTime = now;
  log("OpenCode 在运行但调试端口不通，已发系统通知");
  notify("OpenCode 皮肤", `检测到 OpenCode 没带调试端口，皮肤不可用。恢复请执行：bash ${join(here, "apply-skin.sh")}`);
}

// ---------- 巡检循环 ----------
let sawPortUp = false;
const firstSeen = new Map(); // webSocketDebuggerUrl -> 首次看到的时间（等主题初始化用）

async function pollOnce() {
  let portUp = false;
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    portUp = res.ok;
  } catch {
    portUp = false;
  }

  const state = await readState();

  if (!portUp) {
    discardCachedSession();
    firstSeen.clear();
    // 端口不通 + 应用在跑 = 被普通方式重启了；常驻关或没选过主题就不打扰
    if (state.persistence && state.theme && (sawPortUp || (await appRunning()))) {
      await notifyPortMissing();
    }
    sawPortUp = false;
    return;
  }
  sawPortUp = true;
  if (!state.persistence || !state.theme) return; // 常驻关闭 / 未启用：不注入也不维护
  if (state.busyUntil > Date.now()) return;       // CLI 正在换肤，让行

  const targets = await listTargets(CDP_PORT, { timeoutMs: 2000 }).catch(() => []);
  const { target } = pickMainWindow(classifyTargets(targets));
  if (!target) return; // 窗口还没起来

  if (!firstSeen.has(target.webSocketDebuggerUrl)) firstSeen.set(target.webSocketDebuggerUrl, Date.now());
  if (firstSeen.size > 32) firstSeen.clear();
  const seen = firstSeen.get(target.webSocketDebuggerUrl);

  let health;
  try {
    health = await withMainWindow(target, (s) => s.evaluate(healthScript()));
  } catch {
    return; // 页面导航中，下轮再看
  }
  if (!health || health.notReady) return;

  // 等应用自己的主题初始化落定：data-theme（如 AMOLED）要等 JS 应用完才有值；
  // 一直不出现（用户用默认主题）就等满 10 秒，避免收割到默认 dark 的底色
  if (!health.themeAttr && Date.now() - seen < 10_000) return;

  if (!health.skin && state.theme) {
    const recipe = await loadTheme(state.theme).catch(() => null);
    if (!recipe) {
      log(`巡检：主题 ${state.theme} 不存在，跳过`);
    } else {
      try {
        const { result, tinted } = await withMainWindow(target, (s) => applyRecipe(s, recipe));
        if (result?.applied) {
          log(`巡检：皮肤丢失，已重新注入「${recipe.name}」（染色 ${tinted} 个变量）`);
        } else {
          log(`巡检：重注入未生效（${result?.notReady ? "页面未就绪" : result?.error || "无返回"}）`);
        }
      } catch (e) {
        log(`巡检：重注入失败 ${e.message}`);
      }
    }
  }
  // 主题中心按钮独立于皮肤维护：还原官方外观（theme=null）后按钮也要在，
  // 否则用户没法再从面板选主题
  if (!health.panel) {
    try {
      const r = await withMainWindow(target, (s) => s.evaluate(
        panelInjectionScript(PANEL_SOURCE, { port: API_PORT, styleId: STYLE_ID }),
      ));
      if (r && typeof r.injected === "boolean") {
        log(r.injected ? "巡检：主题中心按钮丢失，已重新注入" : "巡检：主题中心按钮已在场");
      }
    } catch (e) {
      log(`巡检：面板重注入失败 ${e.message}`);
    }
  }
}

// ---------- 生命周期 ----------
// 直接执行才启动巡检；测试 import 时无副作用
const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  // ---------- HTTP API（主题中心面板用） ----------
  const server = http.createServer(createRequestHandler({
    listThemes: listThemesMeta,
    buildCss: buildCssForDir,
    withMainWindow: (fn) => requireMainWindow().then((t) => withMainWindow(t, fn)),
    readState,
    updateState,
    createThemeFromImage,
    log,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    themesRoot: THEMES_ROOT,
  }));
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      log(`端口 ${API_PORT} 已被占用（大概率已有一个守护进程在跑），本进程退出`);
      process.exit(0); // 干净退出：plist 配了 KeepAlive=SuccessfulExit(false)，exit(0) 不会被 launchd 重拉
    }
    log(`HTTP 服务出错：${error.message}`);
    process.exit(1);
  });
  server.listen(API_PORT, "127.0.0.1", () => {
    log(`daemon 已启动：API http://127.0.0.1:${API_PORT} · 巡检 CDP :${CDP_PORT} 每 ${POLL_MS / 1000}s`);
  });

  setInterval(() => pollOnce().catch((e) => log(`巡检异常 ${e.message}`)), POLL_MS);
  pollOnce().catch(() => {});
  process.on("unhandledRejection", (reason) => {
    // 记日志继续跑：巡检路径的杂散 rejection 大多自愈（下轮重试）
    log(`未处理的 Promise 拒绝：${String(reason?.message || reason)}`);
  });
  process.on("uncaughtException", (error) => {
    // uncaughtException 后进程状态未定义，退出让 launchd 拉起干净进程
    log(`未捕获异常，进程退出（launchd 会拉起新实例）：${error?.stack || error}`);
    discardCachedSession();
    try { server.close(); } catch {}
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    log("收到 SIGTERM，退出");
    discardCachedSession();
    try { server.close(); } catch {}
    process.exit(0);
  });
  process.on("SIGINT", () => {
    log("收到 SIGINT，退出");
    discardCachedSession();
    try { server.close(); } catch {}
    process.exit(0);
  });
}

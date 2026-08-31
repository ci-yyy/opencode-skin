#!/usr/bin/env node
// diag.mjs — 一站式体检：守护进程 / 调试端口 / 主窗口 / 注入状态 / state.json / 主题目录
// 逐项检查，每项带修复指引。

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, listTargets, CdpSession, classifyTargets, pickMainWindow } from "./lib/cdp.mjs";
import { listThemes } from "./lib/themes.mjs";
import { readState } from "./lib/state.mjs";
import { healthScript } from "./lib/core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.OPENCODE_SKIN_CDP_PORT) || DEFAULT_PORT;
const LABEL = "com.opencode.skin.daemon";

const results = [];
function item(name, ok, detail, fix) {
  results.push({ name, ok, detail, fix });
}

function cmd(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout) => {
      resolve({ error: !!error, stdout: String(stdout || "") });
    });
  });
}

// 1. 守护进程
{
  const pgrep = await cmd("pgrep", ["-f", "opencode-skin/daemon.mjs"]);
  const running = !pgrep.error && pgrep.stdout.trim().length > 0;
  item(
    "守护进程",
    running,
    running ? `运行中（pid ${pgrep.stdout.trim().split("\n")[0]}）` : "未运行",
    running ? "" : `bash ${join(here, "install-daemon.sh")}`,
  );
}

// 2. 调试端口
{
  let up = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    up = res.ok;
  } catch {}
  item(
    "调试端口",
    up,
    up ? `127.0.0.1:${port} 可达` : `127.0.0.1:${port} 不通（OpenCode 没带调试端口启动，或没在运行）`,
    up ? "" : `bash ${join(here, "apply-skin.sh")}`,
  );
  if (!up) {
    // 端口不通时后面几项没意义，直接出报告
    finish();
  }
}

// 3. 主窗口
let target = null;
{
  try {
    const targets = classifyTargets(await listTargets(port, { timeoutMs: 2000 }));
    const picked = pickMainWindow(targets);
    target = picked.target;
    item(
      "主窗口",
      !!target,
      target ? target.url : `没找到 oc:// 页面（看到 ${targets.length} 个 page 目标）`,
      target ? "" : "OpenCode 可能还在启动，稍等重跑；或主窗口协议变化需要适配 lib/cdp.mjs",
    );
  } catch (e) {
    item("主窗口", false, `探测失败：${e.message}`, "");
  }
  if (!target) finish();
}

// 4. 注入状态
{
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    const health = await session.evaluate(healthScript());
    item("皮肤注入", !!health.skin, health.skin
      ? `在（主题 ${health.skinThemeId}）`
      : "不在（OpenCode 刷新后会丢，守护进程 5 秒内自动补回）", "");
    item("应用主题", true, `data-theme=${health.themeAttr || "(默认)"} · data-color-scheme=${(await session.evaluate('document.documentElement.getAttribute("data-color-scheme")')) || "(默认)"}`, "");
  } finally {
    session.close();
  }
}

// 5. state.json
{
  const state = await readState();
  item("state.json", true, `主题=${state.theme ?? "官方外观"} · 常驻=${state.persistence ? "开" : "关"}`, "");
}

// 6. 主题目录
{
  try {
    const themes = await listThemes();
    const bad = (await readdir(join(here, "themes")))
      .filter((f) => f.endsWith(".json")).length - themes.length;
    item("主题目录", themes.length > 0, `${themes.length} 套可用${bad > 0 ? `（${bad} 个无效被跳过）` : ""}`, "");
  } catch (e) {
    item("主题目录", false, e.message, "");
  }
}

finish();

function finish() {
  console.log(`\nOpenCode Skin 体检（端口 ${port}）\n`);
  for (const r of results) {
    const mark = r.ok ? "✅" : "❌";
    console.log(`  ${mark} ${r.name}：${r.detail}`);
    if (r.fix) console.log(`     ↳ 修复：${r.fix}`);
  }
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${bad === 0 ? "全部正常。" : `${bad} 项异常，按上面指引修复。`}`);
  process.exitCode = bad === 0 ? 0 : 1;
}

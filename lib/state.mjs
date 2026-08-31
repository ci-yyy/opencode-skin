// lib/state.mjs — 状态（工具目录 state.json）：当前主题 / 常驻开关 / busy 防抢占标记
//
// busyUntil：入口（CLI/菜单）正在换肤的时间戳（epoch ms）。守护进程看到 busy 未过期
// 就跳过注入，避免「CLI 刚移除皮肤 → 守护进程抢先注入旧主题 → CLI 收割到染色值」
// 的双重染色竞态；入口崩了没清零，30 秒后自然过期，守护进程恢复工作。
//
// 并发：终端与守护进程会同时写。写入走「读改写 + 临时文件 + 原子改名」，中断不会
// 留下半个 JSON；读改写交错丢 patch 的窗口极小（同一台机器上人手速有限），不做文件锁。

import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 测试可用 OPENCODE_SKIN_STATE_DIR 把状态指到临时目录
const STATE_DIR = process.env.OPENCODE_SKIN_STATE_DIR
  ? resolve(process.env.OPENCODE_SKIN_STATE_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(STATE_DIR, "state.json");

const DEFAULTS = { theme: null, persistence: true, busyUntil: 0 };

export async function readState() {
  let data;
  try {
    data = JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { ...DEFAULTS };
  }
  const state = { ...DEFAULTS };
  if (typeof data.theme === "string") state.theme = data.theme;
  else if (data.theme === null) state.theme = null;
  if (typeof data.persistence === "boolean") state.persistence = data.persistence;
  if (Number.isFinite(data.busyUntil) && data.busyUntil >= 0) state.busyUntil = data.busyUntil;
  return state;
}

export async function updateState(patch) {
  if (!patch || typeof patch !== "object") {
    throw new TypeError("updateState 需要一个 patch 对象");
  }
  // 先校验再动手：坏输入直接抛
  if ("theme" in patch && patch.theme !== null && typeof patch.theme !== "string") {
    throw new TypeError(`theme 必须是字符串或 null，收到：${patch.theme}`);
  }
  if ("persistence" in patch && typeof patch.persistence !== "boolean") {
    throw new TypeError(`persistence 必须是布尔值，收到：${patch.persistence}`);
  }
  if ("busyUntil" in patch && (!Number.isFinite(patch.busyUntil) || patch.busyUntil < 0)) {
    throw new TypeError(`busyUntil 必须是非负数字，收到：${patch.busyUntil}`);
  }
  await mkdir(STATE_DIR, { recursive: true });
  const next = await readState();
  if ("theme" in patch) next.theme = patch.theme;
  if ("persistence" in patch) next.persistence = patch.persistence;
  if ("busyUntil" in patch) next.busyUntil = patch.busyUntil;
  const tmp = join(STATE_DIR, `state.json.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  await writeFile(tmp, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  await rename(tmp, STATE_FILE);
  return next;
}

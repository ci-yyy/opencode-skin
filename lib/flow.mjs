// lib/flow.mjs — 面向入口（CLI/菜单）的完整动作：串起状态与注入
//
// busyUntil 防抢占：换肤期间先置忙再注入，守护进程看到就让行；结束（无论成败）清零，
// 崩溃没清零也有 30 秒兜底自动解除。不做这层协调会出现双重染色：
// CLI 移除皮肤 → 守护进程巡检发现皮肤丢了抢先注入 → CLI 收割到的是染色值 → 染上再加染。

import { updateState } from "./state.mjs";
import { loadTheme } from "./themes.mjs";
import { injectToApp, removeFromApp } from "./core.mjs";

const BUSY_MS = 30_000;

export async function applyThemeById(id, { port, waitMs } = {}) {
  const recipe = await loadTheme(id);
  await updateState({ theme: recipe.id, busyUntil: Date.now() + BUSY_MS });
  try {
    const { result, tinted } = await injectToApp(recipe, { port, waitMs });
    return { result, tinted, recipe };
  } finally {
    await updateState({ busyUntil: 0 });
  }
}

export async function restoreOfficial({ port, waitMs } = {}) {
  await updateState({ theme: null, busyUntil: Date.now() + BUSY_MS });
  try {
    return await removeFromApp({ port, waitMs });
  } finally {
    await updateState({ busyUntil: 0 });
  }
}

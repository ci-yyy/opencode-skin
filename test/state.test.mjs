import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 必须在 import state 模块之前设置（模块加载时读环境变量决定 state 目录）
process.env.OPENCODE_SKIN_STATE_DIR = mkdtempSync(join(tmpdir(), "ocskin-state-"));
const { readState, updateState } = await import("../lib/state.mjs");

test("默认状态", async () => {
  const s = await readState();
  assert.equal(s.theme, null);
  assert.equal(s.persistence, true);
  assert.equal(s.busyUntil, 0);
});

test("增量更新往返（只写传入字段，其余保持）", async () => {
  await updateState({ theme: "deep-teal" });
  await updateState({ persistence: false });
  let s = await readState();
  assert.equal(s.theme, "deep-teal");
  assert.equal(s.persistence, false);
  await updateState({ theme: null, busyUntil: 123 });
  s = await readState();
  assert.equal(s.theme, null);
  assert.equal(s.persistence, false);
  assert.equal(s.busyUntil, 123);
});

test("非法 patch 拒绝", async () => {
  await assert.rejects(() => updateState({ theme: 42 }));
  await assert.rejects(() => updateState({ persistence: "yes" }));
  await assert.rejects(() => updateState({ busyUntil: -1 }));
  await assert.rejects(() => updateState(null));
});

test("state 文件损坏时回默认（不抛错）", async () => {
  const { writeFile } = await import("node:fs/promises");
  const { join: j } = await import("node:path");
  await writeFile(j(process.env.OPENCODE_SKIN_STATE_DIR, "state.json"), "{半个 JSON", "utf8");
  const s = await readState();
  assert.equal(s.theme, null);
  assert.equal(s.persistence, true);
});

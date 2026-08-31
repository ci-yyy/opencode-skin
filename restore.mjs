#!/usr/bin/env node
// restore.mjs — 还原官方外观（效果同 use-skin.sh 还原）

import { restoreOfficial } from "./lib/flow.mjs";
import { DEFAULT_PORT } from "./lib/cdp.mjs";

const port = Number(process.env.OPENCODE_SKIN_CDP_PORT) || DEFAULT_PORT;

try {
  const r = await restoreOfficial({ port, waitMs: 20000 });
  console.log(r?.removed ? "✅ 皮肤已移除，恢复官方外观" : "ℹ️ 本来就没有皮肤");
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequestHandler, originAllowed } from "../lib/http-api.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 测试用假依赖：不碰真实 OpenCode / 磁盘主题
function makeDeps() {
  const state = { theme: null, persistence: true, miniButton: false };
  const themes = [
    { dir: "a", name: "主题A", appearance: "dark", kind: "gradient", swatches: ["#111111", "#222222"] },
    { dir: "b", name: "主题B", appearance: "light", kind: "image", swatches: ["#333333"] },
  ];
  const injected = [];
  return {
    deps: {
      listThemes: async () => themes,
      buildCss: async (dir) => {
        if (dir === "missing") throw new Error("主题不存在");
        return { theme: { id: dir }, css: `/* css of ${dir} */` };
      },
      withMainWindow: async (fn) => fn({ evaluate: async () => ({ applied: true }) }),
      readState: async () => ({ ...state }),
      updateState: async (patch) => Object.assign(state, patch) || { ...state },
      createThemeFromImage: async () => ({ dir: "custom-1234abcd", name: "上传", appearance: "dark" }),
      log: () => {},
      maxUploadBytes: 1024 * 1024,
      themesRoot: mkdtempSync(join(tmpdir(), "ocskin-api-")),
    },
    get state() { return state; },
    injected,
  };
}

async function withServer(deps, fn) {
  const server = http.createServer(createRequestHandler(deps));
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const jsonFetch = async (url, opts = {}) => {
  const res = await fetch(url, opts);
  return { status: res.status, data: await res.json() };
};

test("originAllowed：放行无 Origin / null / oc://，拒绝 https 跨站", () => {
  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed("null"), true);
  assert.equal(originAllowed("oc://renderer"), true);
  assert.equal(originAllowed("https://evil.com"), false);
  assert.equal(originAllowed("http://127.0.0.1:8080"), false);
});

test("GET /themes：返回列表 + 当前主题 + 设置", async () => {
  const { deps } = makeDeps();
  await withServer(deps, async (base) => {
    const { status, data } = await jsonFetch(`${base}/themes`);
    assert.equal(status, 200);
    assert.equal(data.themes.length, 2);
    assert.equal(data.themes[0].name, "主题A");
    assert.equal(data.current, null);
    assert.deepEqual(data.settings, { persistence: true, miniButton: false });
  });
});

test("GET /css/<dir>：返回 CSS；非法目录名 400；不存在 404", async () => {
  const { deps } = makeDeps();
  await withServer(deps, async (base) => {
    const ok = await jsonFetch(`${base}/css/a`);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.ok, true);
    assert.ok(ok.data.css.includes("css of a"));
    const bad = await jsonFetch(`${base}/css/${encodeURIComponent("../etc")}`);
    assert.equal(bad.status, 400);
    const gone = await jsonFetch(`${base}/css/missing`);
    assert.equal(gone.status, 404);
  });
});

test("POST /applied/<dir>：写 state 并校验主题存在；none 清空", async () => {
  const ctx = makeDeps();
  await withServer(ctx.deps, async (base) => {
    const ok = await jsonFetch(`${base}/applied/a`, { method: "POST" });
    assert.equal(ok.status, 200);
    assert.equal(ctx.state.theme, "a");
    const missing = await jsonFetch(`${base}/applied/missing`, { method: "POST" });
    assert.equal(missing.status, 404);
    const none = await jsonFetch(`${base}/applied/none`, { method: "POST" });
    assert.equal(none.status, 200);
    assert.equal(ctx.state.theme, null);
  });
});

test("POST /settings/<key>：布尔值校验", async () => {
  const ctx = makeDeps();
  await withServer(ctx.deps, async (base) => {
    const ok = await jsonFetch(`${base}/settings/persistence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: false }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ctx.state.persistence, false);
    const bad = await jsonFetch(`${base}/settings/persistence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "yes" }),
    });
    assert.equal(bad.status, 400);
    const unknown = await jsonFetch(`${base}/settings/readingEnhance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: true }),
    });
    assert.equal(unknown.status, 404);
  });
});

test("恶意 Origin 一律 403 且不给 CORS 头", async () => {
  const { deps } = makeDeps();
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/themes`, { headers: { Origin: "https://evil.com" } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});

test("GET /random：注入并写 state（避开当前主题）", async () => {
  const ctx = makeDeps();
  ctx.deps.listThemes = async () => [
    { dir: "a", name: "A", appearance: "dark", kind: "plain" },
    { dir: "b", name: "B", appearance: "dark", kind: "plain" },
  ];
  await withServer(ctx.deps, async (base) => {
    await jsonFetch(`${base}/applied/a`, { method: "POST" });
    const { status, data } = await jsonFetch(`${base}/random`);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.dir, "b"); // 只有 b 可选（避开 a）
    assert.equal(ctx.state.theme, "b");
  });
});

test("GET /health：返回 ok", async () => {
  const { deps } = makeDeps();
  await withServer(deps, async (base) => {
    const { status, data } = await jsonFetch(`${base}/health`);
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

test("POST /applied/<dir>：置忙窗口（防守护进程抢注入顶掉面板选择）", async () => {
  const ctx = makeDeps();
  ctx.deps.updateState = async (patch) => {
    Object.assign(ctx.state, patch);
    return { ...ctx.state };
  };
  await withServer(ctx.deps, async (base) => {
    await jsonFetch(`${base}/applied/a`, { method: "POST" });
    assert.ok(ctx.state.busyUntil > Date.now(), "上报后应置 busyUntil（未来时间）");
    assert.ok(ctx.state.busyUntil <= Date.now() + 10000, "busy 窗口应在合理范围（≤10s）");
  });
});

test("未知路由 404", async () => {
  const { deps } = makeDeps();
  await withServer(deps, async (base) => {
    const { status } = await jsonFetch(`${base}/nope`);
    assert.equal(status, 404);
  });
});

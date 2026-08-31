// lib/http-api.mjs — 主题中心数据服务的 HTTP API（127.0.0.1:9346）
// 从 daemon.mjs 拆出：路由、Origin 校验、请求体读取与体积上限。
// 全部外部依赖（主题工具 / CDP 会话 / 状态读写 / 图片建主题）经 createRequestHandler(deps)
// 注入，测试可以整套替换（见 test/api.test.mjs）。

import {
  STYLE_ID,
  injectionScript,
  removalScript,
} from "./core.mjs";

const DEFAULT_THEMES_ROOT = new URL("../themes/", import.meta.url).pathname;

// ---------- 请求体读取 ----------
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new Error(`上传内容超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", (error) => { if (!done) { done = true; reject(error); } });
  });
}

// ---------- Origin 校验 ----------
// 这个 API 只服务 OpenCode 里的注入面板（oc:// 页面，Origin 序列化为 null）和
// 本机进程（curl/Node，没有 Origin 头）。浏览器里 https:// 网页的 JS 也能对
// 127.0.0.1 发请求，所以不能无条件放行。
export function originAllowed(origin) {
  if (origin === undefined) return true;  // curl / Node 等非浏览器客户端
  if (origin === "null") return true;     // OpenCode 的 oc:// 面板
  return typeof origin === "string" && origin.startsWith("oc://");
}

// ---------- HTTP API（供面板） ----------
export function createRequestHandler(deps) {
  const {
    listThemes,
    buildCss,
    withMainWindow,
    readState: read,
    updateState: update,
    createThemeFromImage,
    log,
    maxUploadBytes,
  } = deps;
  const themesRoot = deps.themesRoot || DEFAULT_THEMES_ROOT;

  function json(res, status, data, origin, cors = true) {
    // 读 body 超限后 socket 已被销毁，再写会抛 ERR_STREAM_WRITE_AFTER_END
    if (res.writableEnded || res.destroyed) return;
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    // 只回显校验过的来源，不写通配 *；拒绝的请求一个 CORS 头都不给
    if (cors && origin !== undefined) headers["Access-Control-Allow-Origin"] = origin;
    res.writeHead(status, headers);
    res.end(status === 204 ? "" : JSON.stringify(data));
  }

  // 目录名统一走这里解码+校验：畸形转义返回 null（400），合法但含路径成分/控制字符也拒
  function safeDirName(raw) {
    let dir;
    try {
      dir = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!dir || dir.includes("..") || dir.includes("/") || dir.includes("\\")) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(dir)) return null;
    return dir;
  }

  return async function handleRequest(req, res) {
    const origin = req.headers.origin;
    try {
      // 先校验来源再处理任何方法（含 OPTIONS 预检）：恶意页面的预检也直接拒绝，
      // 不给浏览器「可以继续发实际请求」的信号
      if (!originAllowed(origin)) {
        log?.(`API 拒绝来源：${origin} ${req.method} ${req.url}`);
        return json(res, 403, { ok: false, error: "forbidden origin" }, origin, false);
      }
      if (req.method === "OPTIONS") return json(res, 204, {}, origin);

      const url = new URL(req.url, `http://127.0.0.1:${req.socket?.localPort || 9346}`);

      if (req.method === "GET" && url.pathname === "/themes") {
        const themes = await listThemes();
        const state = await read();
        return json(res, 200, {
          current: state.theme,
          themes,
          settings: {
            persistence: state.persistence,
            miniButton: state.miniButton,
          },
        }, origin);
      }

      const cssMatch = url.pathname.match(/^\/css\/([^/]+)$/);
      if (req.method === "GET" && cssMatch) {
        const dir = safeDirName(cssMatch[1]);
        if (!dir) return json(res, 400, { ok: false, error: "非法目录名" }, origin);
        try {
          const { theme, css } = await buildCss(dir);
          return json(res, 200, { ok: true, id: theme.id, css }, origin);
        } catch (e) {
          return json(res, 404, { ok: false, error: `主题不存在或无效：${e.message}` }, origin);
        }
      }

      // 随机主题：从全部主题里挑一个（尽量避开当前）
      if (req.method === "GET" && url.pathname === "/random") {
        const themes = await listThemes();
        if (themes.length === 0) return json(res, 404, { ok: false, error: "没有可用主题" }, origin);
        const state = await read();
        const pool = themes.length > 1 ? themes.filter((t) => t.dir !== state.theme) : themes;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const { theme, css } = await buildCss(pick.dir);
        const applied = await withMainWindow((s) => s.evaluate(injectionScript(css, theme.id)));
        if (!applied?.applied) return json(res, 500, { ok: false, error: "注入失败" }, origin);
        await update({ theme: pick.dir });
        log?.(`面板：随机切换到「${pick.dir}」`);
        return json(res, 200, { ok: true, dir: pick.dir, name: pick.name, id: theme.id, css }, origin);
      }

      const appliedMatch = url.pathname.match(/^\/applied\/([^/]+)$/);
      if (appliedMatch && req.method === "POST") {
        const dir = safeDirName(appliedMatch[1]);
        if (dir === "none") {
          await withMainWindow((s) => s.evaluate(removalScript())).catch(() => {});
          await update({ theme: null });
          log?.("面板：还原官方外观");
          return json(res, 200, { ok: true }, origin);
        }
        if (!dir) return json(res, 400, { ok: false, error: "非法目录名" }, origin);
        // 写进 state.json 的主题守护进程会反复恢复：不存在的目录会让巡检每 5 秒
        // 报一次重注入失败，写之前先确认主题真的能加载（apply.mjs 终端路径同此逻辑）
        const themes = await listThemes();
        if (!themes.some((t) => t.dir === dir)) {
          return json(res, 404, { ok: false, error: `主题不存在：${dir}` }, origin);
        }
        await update({ theme: dir });
        log?.(`面板：切换到「${dir}」`);
        return json(res, 200, { ok: true }, origin);
      }

      // 设置开关：persistence / miniButton
      const settingMatch = url.pathname.match(/^\/settings\/(persistence|miniButton)$/);
      if (settingMatch && req.method === "POST") {
        const key = settingMatch[1];
        let body;
        try {
          body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
        } catch {
          return json(res, 400, { ok: false, error: "请求体不是合法 JSON" }, origin);
        }
        if (typeof body !== "object" || body === null || typeof body.value !== "boolean") {
          return json(res, 400, { ok: false, error: "需要 { value: true/false }" }, origin);
        }
        const state = await update({ [key]: body.value });
        log?.(`面板：设置 ${key} = ${body.value}`);
        return json(res, 200, { ok: true, state: { persistence: state.persistence, miniButton: state.miniButton } }, origin);
      }

      // 上传图片建主题（multipart 简化实现：面板用 FormData）
      if (req.method === "POST" && url.pathname === "/upload-theme") {
        const contentType = req.headers["content-type"] || "";
        if (!contentType.includes("multipart/form-data")) {
          return json(res, 400, { ok: false, error: "需要 multipart/form-data 上传" }, origin);
        }
        const body = await readBody(req, maxUploadBytes);
        // 解析 multipart：拿文件块 + name 字段
        const boundary = Buffer.from(`--${contentType.split("boundary=")[1]}`, "binary");
        const parts = [];
        let idx = body.indexOf(boundary);
        while (idx !== -1) {
          const next = body.indexOf(boundary, idx + boundary.length);
          if (next === -1) break;
          let part = body.subarray(idx + boundary.length + 2, next - 2); // 去掉 \r\n 前后缀
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd !== -1) {
            const headers = part.subarray(0, headerEnd).toString("utf8");
            parts.push({ headers, data: part.subarray(headerEnd + 4) });
          }
          idx = next;
        }
        const filePart = parts.find((p) => /filename="[^"]+"/.test(p.headers));
        const namePart = parts.find((p) => /name="name"/.test(p.headers) && !/filename=/.test(p.headers));
        if (!filePart) return json(res, 400, { ok: false, error: "没收到图片文件" }, origin);
        const filename = (filePart.headers.match(/filename="([^"]+)"/) || [])[1] || "upload.png";
        const ext = (filename.match(/(\.[a-z0-9]+)$/i) || [])[1] || "";
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext.toLowerCase())) {
          return json(res, 400, { ok: false, error: `只支持 PNG/JPG/WebP，收到：${ext || "无后缀"}` }, origin);
        }
        const customName = namePart ? namePart.data.toString("utf8").trim() : "";

        // 存到临时文件 → 走和 create-theme.mjs 完全相同的建主题流程
        const { writeFile, rm, mkdir } = await import("node:fs/promises");
        const tmpDir = new URL("../logs/", import.meta.url).pathname;
        await mkdir(tmpDir, { recursive: true });
        const tmpFile = `${tmpDir}upload-${process.pid}-${Date.now()}${ext.toLowerCase()}`;
        await writeFile(tmpFile, filePart.data);
        try {
          const result = await withMainWindow((s) => createThemeFromImage({
            session: s,
            imagePath: tmpFile,
            name: customName || null,
            id: null,
            appearance: "auto",
            force: true, // 同名/同图幂等覆盖
            themesRoot,
          }));
          if (result.dir.includes("..") || result.dir.includes("/")) {
            return json(res, 500, { ok: false, error: "生成的主题目录名非法" }, origin);
          }
          log?.(`面板：上传图片生成主题「${result.dir}」`);
          return json(res, 200, { ok: true, dir: result.dir, name: result.name, appearance: result.appearance }, origin);
        } finally {
          await rm(tmpFile, { force: true });
        }
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, pid: process.pid, styleId: STYLE_ID }, origin);
      }

      json(res, 404, { ok: false, error: "not found" }, origin);
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message || e) }, origin);
    }
  };
}

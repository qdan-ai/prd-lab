import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { RENDERERS } from "@prd-lab/core";

export const runtime = "nodejs";

/**
 * Renderer 静态资源 mount（DESIGN §6.3 / 决策 D18 / D19）。
 *
 * URL: /_renderers/{name}/static/{...path} → 读 node_modules/@prd-lab/renderer-{name}/dist/{...path}
 *
 * 安全约束（codex P2）：
 *   - allowlist 后缀（D18：禁 .map / .ts / .env / 未知扩展名）
 *   - safePath 防穿越（resolve 后必须仍在 distDir 内）
 *   - X-Content-Type-Options: nosniff
 *   - 长缓存 + immutable（Vite hash 化资源；新版本自动失效）
 *   - 公开缓存（任何人凭 URL 可拉）— SPA bundle 不含 secrets/业务数据；安全论证见 §6.5
 */

const require = createRequire(import.meta.url);

const distDirCache = new Map<string, string>();

const ALLOWED_EXTS = new Set([
  "js",
  "mjs",
  "css",
  "html",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "json",
]);

const CONTENT_TYPES: Record<string, string> = {
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

type Ctx = { params: Promise<{ name: string; path: string[] }> };

export async function GET(_: Request, { params }: Ctx) {
  const { name, path } = await params;

  if (!RENDERERS[name]) {
    return text(404, `renderer ${name} not registered`);
  }

  const rel = (path ?? []).join("/");
  if (
    rel.length === 0 ||
    rel.length > 1024 ||
    rel.includes("..") ||
    rel.includes("\\") ||
    rel.includes("\0") ||
    rel.startsWith("/")
  ) {
    return text(400, "invalid path");
  }

  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return text(403, `ext .${ext} not allowed`);
  }

  let distDir = distDirCache.get(name);
  if (!distDir) {
    const located = locateRendererDistDir(name);
    if (!located) {
      return text(500, `renderer ${name} package not installed`);
    }
    distDir = located;
    distDirCache.set(name, distDir);
  }

  const filePath = resolve(distDir, rel);
  // safePath：resolve 后必须以 distDir + 平台分隔符 开头
  if (!filePath.startsWith(distDir + sep)) {
    return text(403, "path escape");
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return text(404, "asset not found");
  }

  // Web Response 在 TS 严格模式下要求 ArrayBuffer（非 SharedArrayBuffer/ArrayBufferLike）
  // Node Buffer 的底层缓冲是 ArrayBufferLike，要一次性 copy 为干净 ArrayBuffer
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new Response(ab, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * 同 renderer-shell.ts 的 resolveRendererPkgDir：兼容 next dev（Turbopack）下
 * require.resolve 返回 `[project]/...` 占位的问题。
 */
function locateRendererDistDir(name: string): string | null {
  try {
    const pkgPath = require.resolve(`@prd-lab/renderer-${name}/package.json`);
    const dir = resolve(dirname(pkgPath), "dist");
    if (existsSync(dir)) return dir;
  } catch {
    // 落到 fallback
  }
  const fallback = resolve(process.cwd(), "node_modules", `@prd-lab/renderer-${name}`, "dist");
  return existsSync(fallback) ? fallback : null;
}

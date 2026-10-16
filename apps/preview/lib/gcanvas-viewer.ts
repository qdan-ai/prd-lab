import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * G-canvas 只读查看器成品包（apps/preview/vendor/gcanvas-viewer/<版本>/，提交进 git）。
 *
 * 目录约定：
 *   vendor/gcanvas-viewer/current.json      { "version": "<版本>" }，外壳挂载的版本
 *   vendor/gcanvas-viewer/<版本>/           成品包原样：bundle.json、入口 JS、首屏 CSS、chunks/、assets/、fonts/
 * 静态路由 /gcanvas-viewer/<版本>/<路径> 只读这个目录；更新成品包用 scripts/update-gcanvas-viewer.mjs。
 * 测试用环境变量 GCANVAS_VIEWER_DIR 改指向另一个同结构目录。
 */

export type ViewerBundle = { version: string; entry: string; css: string };

const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SEGMENT_RE = /^[A-Za-z0-9_@~-][A-Za-z0-9_@~.-]*$/;

/** 只放行成品包会用到的文件类型；.map、.ts、.env 等一律不出 */
export const VIEWER_CONTENT_TYPES: Record<string, string> = {
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

export function viewerVendorDir(): string | null {
  const override = process.env.GCANVAS_VIEWER_DIR;
  if (override) return resolve(override);
  // next start / next dev 的工作目录是 apps/preview；在仓库根起时落到第二个候选
  for (const base of [process.cwd(), resolve(process.cwd(), "apps/preview")]) {
    const dir = resolve(base, "vendor/gcanvas-viewer");
    if (existsSync(dir)) return dir;
  }
  return null;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** 当前要挂的成品包；目录、入口或样式缺任何一个都当没有（外壳回落占位页） */
export function currentViewerBundle(): ViewerBundle | null {
  const root = viewerVendorDir();
  if (!root) return null;
  const current = readJson(resolve(root, "current.json")) as { version?: unknown } | null;
  const version = current?.version;
  if (typeof version !== "string" || !VERSION_RE.test(version)) return null;
  const dir = resolve(root, version);
  if (!dir.startsWith(root + sep)) return null;
  const bundle = readJson(resolve(dir, "bundle.json")) as { entry?: unknown; css?: unknown } | null;
  const entry = bundle?.entry;
  const css = bundle?.css;
  if (typeof entry !== "string" || typeof css !== "string") return null;
  if (!isSafeRel(entry) || !isSafeRel(css)) return null;
  if (!isFile(resolve(dir, entry)) || !isFile(resolve(dir, css))) return null;
  return { version, entry, css };
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isSafeRel(rel: string): boolean {
  return rel.split("/").every((s) => s !== "" && SEGMENT_RE.test(s) && !s.includes(".."));
}

export type ViewerFileResult =
  | { ok: true; file: string; contentType: string }
  | { ok: false; status: 400 | 403 | 404; message: string };

/** 把请求路径 [版本, ...文件路径] 映射到成品包里的文件；白名单后缀、逐段字符集、resolve 后仍在版本目录内 */
export function resolveViewerFile(segments: string[]): ViewerFileResult {
  const [version, ...rest] = segments;
  if (!version || rest.length === 0 || segments.length > 16) return { ok: false, status: 400, message: "invalid path" };
  if (!VERSION_RE.test(version) || version.includes("..")) return { ok: false, status: 400, message: "invalid path" };
  if (!rest.every((s) => SEGMENT_RE.test(s) && !s.includes(".."))) return { ok: false, status: 400, message: "invalid path" };
  const rel = rest.join("/");
  if (rel.length > 512) return { ok: false, status: 400, message: "invalid path" };

  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  const contentType = VIEWER_CONTENT_TYPES[ext];
  if (!rel.includes(".") || !contentType) return { ok: false, status: 403, message: `ext .${ext} not allowed` };

  const root = viewerVendorDir();
  if (!root) return { ok: false, status: 404, message: "viewer bundle not installed" };
  const dir = resolve(root, version);
  const file = resolve(dir, rel);
  if (!dir.startsWith(root + sep) || !file.startsWith(dir + sep)) {
    return { ok: false, status: 403, message: "path escape" };
  }
  if (!isFile(file)) return { ok: false, status: 404, message: "asset not found" };
  return { ok: true, file, contentType };
}

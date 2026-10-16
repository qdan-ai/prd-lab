import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "../app/gcanvas-viewer/[...path]/route";
import { buildRendererCsp } from "./renderer-csp";
import { currentViewerBundle, resolveViewerFile } from "./gcanvas-viewer";

let tmp: string;
let vendor: string;
const prevEnv = process.env.GCANVAS_VIEWER_DIR;

function put(rel: string, body: string) {
  const p = join(vendor, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
}

function useFixture(version = "abc12345") {
  put(`${version}/bundle.json`, JSON.stringify({ name: "gcanvas-viewer", entry: "gcanvas-viewer.js", css: "gcanvas-viewer.css" }));
  put(`${version}/gcanvas-viewer.js`, "export const mountRepoViewer = () => {}");
  put(`${version}/gcanvas-viewer.css`, ".hc-repo-viewer{}");
  put(`${version}/chunks/a-1.js`, "export default 1");
  put(`${version}/fonts/Assistant/A-Regular.woff2`, "font");
  put(`${version}/secret.env`, "SECRET=1");
  put(`${version}/chunks/a-1.js.map`, "{}");
  put(`${version}/.hidden.js`, "x");
  put("outside.js", "export const leak = 1");
  put("current.json", JSON.stringify({ version }));
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "gcv-"));
  vendor = join(tmp, "vendor");
  process.env.GCANVAS_VIEWER_DIR = vendor;
  useFixture();
});

afterAll(() => {
  if (prevEnv === undefined) delete process.env.GCANVAS_VIEWER_DIR;
  else process.env.GCANVAS_VIEWER_DIR = prevEnv;
  rmSync(tmp, { recursive: true, force: true });
});

const get = (...path: string[]) => GET(new Request("http://x/gcanvas-viewer/" + path.join("/")), { params: Promise.resolve({ path }) });

describe("currentViewerBundle", () => {
  it("current.json 指向的版本完整时返回入口与样式", () => {
    expect(currentViewerBundle()).toEqual({ version: "abc12345", entry: "gcanvas-viewer.js", css: "gcanvas-viewer.css" });
  });

  it("current.json 缺失、版本号不合法、版本目录缺入口或样式都当没有成品包", () => {
    put("current.json", JSON.stringify({ version: "../etc" }));
    expect(currentViewerBundle()).toBeNull();
    put("current.json", JSON.stringify({ version: "nope0000" }));
    expect(currentViewerBundle()).toBeNull();
    put("current.json", "not json");
    expect(currentViewerBundle()).toBeNull();
    put("v2/bundle.json", JSON.stringify({ entry: "gcanvas-viewer.js", css: "gcanvas-viewer.css" }));
    put("v2/gcanvas-viewer.js", "x");
    put("current.json", JSON.stringify({ version: "v2" }));
    expect(currentViewerBundle()).toBeNull();
    put("v2/gcanvas-viewer.css", "x");
    expect(currentViewerBundle()).toEqual({ version: "v2", entry: "gcanvas-viewer.js", css: "gcanvas-viewer.css" });
    put("v2/bundle.json", JSON.stringify({ entry: "../outside.js", css: "gcanvas-viewer.css" }));
    expect(currentViewerBundle()).toBeNull();
    put("v3/bundle.json", JSON.stringify({ entry: "missing.js", css: "gcanvas-viewer.css" }));
    put("v3/gcanvas-viewer.css", "x");
    put("current.json", JSON.stringify({ version: "v3" }));
    expect(currentViewerBundle()).toBeNull();
    put("current.json", JSON.stringify({ version: "abc12345" }));
  });

  it("没有 vendor 目录时返回 null", () => {
    process.env.GCANVAS_VIEWER_DIR = join(tmp, "no-such-dir");
    expect(currentViewerBundle()).toBeNull();
    process.env.GCANVAS_VIEWER_DIR = vendor;
  });
});

describe("静态路由 /gcanvas-viewer/<版本>/…", () => {
  it("放行入口、分块、字体并给正确类型与缓存头", async () => {
    const js = await get("abc12345", "gcanvas-viewer.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("application/javascript");
    expect(js.headers.get("x-content-type-options")).toBe("nosniff");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await js.text()).toContain("mountRepoViewer");
    expect((await get("abc12345", "gcanvas-viewer.css")).headers.get("content-type")).toContain("text/css");
    expect((await get("abc12345", "chunks", "a-1.js")).status).toBe(200);
    const font = await get("abc12345", "fonts", "Assistant", "A-Regular.woff2");
    expect(font.status).toBe(200);
    expect(font.headers.get("content-type")).toBe("font/woff2");
  });

  it("后缀不在白名单：.map、.env、无后缀都 403", async () => {
    expect((await get("abc12345", "chunks", "a-1.js.map")).status).toBe(403);
    expect((await get("abc12345", "secret.env")).status).toBe(403);
    expect((await get("abc12345", "chunks")).status).toBe(403);
  });

  it("路径穿越与异常路径：.. 、反斜杠、点开头、空段、版本缺失都被拒，读不到版本目录之外的文件", async () => {
    for (const segs of [
      ["abc12345", "..", "outside.js"],
      ["..", "outside.js"],
      ["abc12345", "chunks", "..", "..", "outside.js"],
      ["abc12345", "..\\outside.js"],
      ["abc12345", "chunks/../../outside.js"],
      ["abc12345", ".hidden.js"],
      ["abc12345", "a..b.js"],
      ["abc12345", "", "a-1.js"],
      ["abc12345", "bundle.json\0.js"],
      ["abc12345"],
      [],
    ]) {
      const res = await get(...segs);
      expect([400, 403], JSON.stringify(segs)).toContain(res.status);
      expect(await res.text()).not.toContain("leak");
    }
    expect((await get("current.json")).status).toBe(400);
  });

  it("文件不存在或版本不存在 404", async () => {
    expect((await get("abc12345", "chunks", "nope.js")).status).toBe(404);
    expect((await get("zzzz9999", "gcanvas-viewer.js")).status).toBe(404);
  });
});

describe("renderer CSP", () => {
  it("默认 img-src 不含 https:；仓库外壳 httpsImages 只在 img-src 放开 https:，脚本与字体不放", () => {
    expect(buildRendererCsp()).toContain("img-src 'self' data: blob:;");
    expect(buildRendererCsp()).not.toContain("https:;");
    const csp = buildRendererCsp({ httpsImages: true });
    expect(csp).toContain("img-src 'self' data: blob: https:;");
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("font-src 'self' data:;");
    expect(csp).toContain("connect-src 'self';");
    expect(csp.match(/https:(?!\/\/)/g)).toHaveLength(1);
  });
});

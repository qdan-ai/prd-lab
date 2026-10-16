import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentViewerBundle, resolveViewerFile } from "./gcanvas-viewer";

const vendor = resolve(dirname(fileURLToPath(import.meta.url)), "../vendor/gcanvas-viewer");
const prevEnv = process.env.GCANVAS_VIEWER_DIR;
beforeAll(() => {
  process.env.GCANVAS_VIEWER_DIR = vendor;
});
afterAll(() => {
  if (prevEnv === undefined) delete process.env.GCANVAS_VIEWER_DIR;
  else process.env.GCANVAS_VIEWER_DIR = prevEnv;
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("提交进仓库的成品包", () => {
  it("current.json 指向完整的成品包，且包里每个文件都能经静态路由取到", () => {
    const bundle = currentViewerBundle();
    expect(bundle).not.toBeNull();
    const dir = join(vendor, bundle!.version);
    const files = walk(dir);
    expect(files.length).toBeGreaterThan(0);
    const blocked = files
      .map((f) => relative(dir, f).split("\\").join("/"))
      .filter((rel) => !resolveViewerFile([bundle!.version, ...rel.split("/")]).ok);
    expect(blocked).toEqual([]);
  });
});

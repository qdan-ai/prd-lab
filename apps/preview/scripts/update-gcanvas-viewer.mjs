#!/usr/bin/env node
/**
 * 更新 G-canvas 只读查看器成品包：把 G-canvas 的 `npm run build:readonly` 产物（viewer/dist-readonly/）
 * 复制到 apps/preview/vendor/gcanvas-viewer/<版本>/，并把 current.json 指向它。
 *
 * 用法：
 *   node apps/preview/scripts/update-gcanvas-viewer.mjs <dist-readonly 目录> [--force] [--dry-run]
 *   （也可用环境变量 GCANVAS_VIEWER_DIST 给出目录）
 *
 * <版本> 取 bundle.json 的 gcanvasCommit 前 8 位。同一版本目录已存在且内容不同：默认拒绝（版本目录按不可变缓存），
 * 加 --force 才覆盖。旧版本目录不会被删除，确认不再需要后手动清理。
 * 更新后：git add apps/preview/vendor/gcanvas-viewer，核对后提交，再部署。
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vendorRoot = process.env.GCANVAS_VIEWER_DIR
  ? resolve(process.env.GCANVAS_VIEWER_DIR)
  : resolve(here, "../vendor/gcanvas-viewer");

// 与 lib/gcanvas-viewer.ts 的静态路由白名单保持一致：不在名单里的文件访客取不到，复制时就拦下
const SEGMENT_RE = /^[A-Za-z0-9_@~-][A-Za-z0-9_@~.-]*$/;
const EXTS = new Set(["js", "mjs", "css", "json", "woff2", "woff", "ttf", "png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

function fail(msg) {
  console.error(`update-gcanvas-viewer: ${msg}`);
  process.exit(1);
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out;
}

function digestOf(dir) {
  const h = createHash("sha256");
  for (const rel of listFiles(dir)) {
    h.update(rel + "\0");
    h.update(createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex") + "\n");
  }
  return h.digest("hex");
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const src = resolve(args.find((a) => !a.startsWith("--")) ?? process.env.GCANVAS_VIEWER_DIST ?? "");
if (!args.find((a) => !a.startsWith("--")) && !process.env.GCANVAS_VIEWER_DIST) {
  fail("缺少成品包目录参数（G-canvas 的 viewer/dist-readonly）");
}
if (!existsSync(join(src, "bundle.json"))) fail(`${src} 里没有 bundle.json，不是成品包目录`);

const bundle = JSON.parse(readFileSync(join(src, "bundle.json"), "utf8"));
if (bundle.name !== "gcanvas-viewer") fail(`bundle.json 的 name 不是 gcanvas-viewer：${bundle.name}`);
if (typeof bundle.gcanvasCommit !== "string" || !/^[0-9a-f]{8,40}$/.test(bundle.gcanvasCommit)) {
  fail("bundle.json 缺少合法的 gcanvasCommit");
}
for (const key of ["entry", "css"]) {
  if (typeof bundle[key] !== "string" || !existsSync(join(src, bundle[key]))) fail(`bundle.json 的 ${key} 指向的文件不存在`);
}

const files = listFiles(src);
const bad = files.filter((rel) => {
  const segs = rel.split("/");
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  return !segs.every((s) => SEGMENT_RE.test(s) && !s.includes("..")) || !rel.includes(".") || !EXTS.has(ext);
});
if (bad.length > 0) fail(`成品包里有静态路由不放行的文件（访客取不到）：\n  ${bad.slice(0, 10).join("\n  ")}`);

const version = bundle.gcanvasCommit.slice(0, 8);
const dest = join(vendorRoot, version);
const srcDigest = digestOf(src);
const total = files.reduce((n, rel) => n + statSync(join(src, rel)).size, 0);
console.log(`来源 ${src}\n版本 ${version}（G-canvas 提交 ${bundle.gcanvasCommit}，构建于 ${bundle.builtAt}）\n文件 ${files.length} 个，共 ${(total / 1048576).toFixed(1)} MB`);

if (existsSync(dest)) {
  if (digestOf(dest) === srcDigest) {
    console.log("版本目录已存在且内容一致，不重复复制");
  } else if (!force) {
    fail(`${dest} 已存在且内容不同；同一提交重新构建出了不同产物。确认要覆盖请加 --force`);
  }
}

if (dryRun) {
  console.log("[dry-run] 不写入");
  process.exit(0);
}

if (!existsSync(dest) || digestOf(dest) !== srcDigest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  if (digestOf(dest) !== srcDigest) fail("复制后内容指纹与来源不一致");
  console.log(`已复制到 ${dest}`);
}
mkdirSync(vendorRoot, { recursive: true });
writeFileSync(join(vendorRoot, "current.json"), JSON.stringify({ version }, null, 2) + "\n");
console.log(`current.json -> ${version}\n下一步：git add apps/preview/vendor/gcanvas-viewer，核对后提交`);

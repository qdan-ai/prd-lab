import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMetadata } from "./node/index";

/**
 * Vite 配置：
 * - base: './' 相对路径，prd-lab 注入 SPA HTML 时统一加前缀；mount path 改变无需重 build
 * - build.sourcemap: false 生产关闭 source map（避免暴露 SPA 源码）
 * - 生产入口只有 index.html（→ src/main.tsx）；dev.html 是本地开发入口，不进 dist
 *
 * 本配置 ONLY 编译 SPA 部分；node/index.ts 走 tsc -p tsconfig.node.json 单独编译。
 */
export default defineConfig({
  base: "./",
  plugins: [react(), devFixtures()],
  build: {
    outDir: "dist",
    sourcemap: false,
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    port: 5173,
  },
});

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIXTURES_ROUTE = "/__fixtures/";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".excalidraw": "application/json; charset=utf-8",
  ".drawio": "application/xml; charset=utf-8",
};

/**
 * 本地开发入口的数据源（仅 dev server）：把 fixtures/<目录名>/ 当作一块已上传的画板原样提供。
 *   GET /__fixtures/                    → 可用画板目录名列表
 *   GET /__fixtures/<目录名>/__meta.json → 与生产同一 computeMetadata 算出的 __computed（docs 列表等）
 *   GET /__fixtures/<目录名>/<相对路径>  → 画板文件原文（不经 Vite 转换，等同预览站的 dataBaseUrl）
 * 配合 dev.html?board=<目录名> 使用。
 */
function devFixtures(): Plugin {
  return {
    name: "prd-lab-dev-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(FIXTURES_ROUTE)) return next();
        const rel = decodeURIComponent(url.slice(FIXTURES_ROUTE.length));
        const send = (status: number, type: string, body: string | Buffer) => {
          res.statusCode = status;
          res.setHeader("Content-Type", type);
          res.setHeader("Cache-Control", "no-store");
          res.end(body);
        };

        if (rel === "") {
          const boards = readdirSync(FIXTURES_DIR).filter((d) =>
            existsSync(path.join(FIXTURES_DIR, d, "canvas.json")),
          );
          return send(200, CONTENT_TYPES[".json"]!, JSON.stringify(boards));
        }

        const abs = path.resolve(FIXTURES_DIR, rel);
        if (!abs.startsWith(FIXTURES_DIR + path.sep)) return send(400, "text/plain", "bad path");
        const [board, ...rest] = rel.split("/");
        const boardDir = path.join(FIXTURES_DIR, board!);

        if (rest.join("/") === "__meta.json") {
          if (!existsSync(path.join(boardDir, "canvas.json"))) return send(404, "text/plain", "board not found");
          const files = walk(boardDir).map((f) => {
            const buffer = readFileSync(f);
            return {
              relPath: path.relative(boardDir, f).split(path.sep).join("/"),
              contentType: CONTENT_TYPES[path.extname(f)] ?? "application/octet-stream",
              sizeBytes: buffer.length,
              sha256: "",
              buffer,
            };
          });
          return send(200, CONTENT_TYPES[".json"]!, JSON.stringify(computeMetadata(files)));
        }

        if (!existsSync(abs) || !statSync(abs).isFile()) return send(404, "text/plain", "not found");
        return send(200, CONTENT_TYPES[path.extname(abs)] ?? "application/octet-stream", readFileSync(abs));
      });
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

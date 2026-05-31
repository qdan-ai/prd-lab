import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite 配置（DESIGN §7.1 / D8 / D19）：
 * - base: './' 相对路径，prd-lab 注入 SPA HTML 时统一加前缀；mount path 改变无需重 build
 * - build.sourcemap: false 生产关闭 source map（避免暴露 SPA 源码）
 * - 入口为 src/main.tsx，dist/index.html 由 vite 自动从 index.html 模板生成
 *
 * 本配置 ONLY 编译 SPA 部分；node/computeMetadata 走 tsc -p tsconfig.node.json 单独编译。
 */
export default defineConfig({
  base: "./",
  plugins: [react()],
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

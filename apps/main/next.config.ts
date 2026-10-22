import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// 加载 monorepo root .env（apps/main 不再单独维护 .env）
loadEnv({ path: resolve(process.cwd(), "../../.env") });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@prd-lab/core"],
  // 允许 nginx 反代域名访问 dev resources（HMR/RSC chunks）
  allowedDevOrigins: ["app.local", "preview.local"],
  experimental: {
    // proxy.ts 命中的非 GET 请求，Next 会把请求体复制一份给 proxy，默认只复制前 10MB、
    // 超出部分路由拿不到（zip 上传上限 50MB 会被截断）。放到与 nginx client_max_body_size 一致。
    proxyClientMaxBodySize: "100mb",
  },
};

export default config;

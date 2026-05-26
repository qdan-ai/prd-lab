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
};

export default config;

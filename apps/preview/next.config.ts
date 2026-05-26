import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// 加载 monorepo root .env（apps/preview 不单独维护 .env）
loadEnv({ path: resolve(process.cwd(), "../../.env") });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@prd-lab/core"],
  allowedDevOrigins: ["app.local", "preview.local"],
};

export default config;

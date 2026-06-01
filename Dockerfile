# syntax=docker/dockerfile:1.7
# 生产用 Dockerfile：一份镜像同时承载 main 与 preview，启动时 docker-compose 决定跑哪个

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# --- Stage 1: 依赖层（缓存友好，仅在 lockfile / package.json 变化时失效） ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/main/package.json apps/main/
COPY apps/preview/package.json apps/preview/
COPY packages/core/package.json packages/core/
COPY packages/prd-cli/package.json packages/prd-cli/
COPY packages/renderer-pm-canvas/package.json packages/renderer-pm-canvas/
RUN pnpm install --frozen-lockfile

# --- Stage 2: 构建 renderer 包（产出 dist + dist-node，apps/preview 运行时读取）→ main + preview ---
# 决策 D5：renderer 包 dist 不进 git，在镜像构建期生成。renderer 必须先于 apps/preview 编译，
# 否则 apps/preview 的 import { computeMetadata } from "@prd-lab/renderer-pm-canvas/node"
# 会因 dist-node/ 不存在而 typecheck 失败。
FROM deps AS builder
# Next.js NEXT_PUBLIC_* 是 build time inline，必须在 `next build` 跑前进 process.env。
# 由 docker-compose.prod.yml main 服务的 build.args 段传入；
# 本地 docker build 不传则等价于"不设"，前端 fallback 到 http://preview.local（开发默认）。
ARG NEXT_PUBLIC_PREVIEW_ORIGIN
ENV NEXT_PUBLIC_PREVIEW_ORIGIN=$NEXT_PUBLIC_PREVIEW_ORIGIN
COPY . .
RUN pnpm --filter @prd-lab/renderer-pm-canvas build
RUN pnpm --filter @prd-lab/main build
RUN pnpm --filter @prd-lab/preview build

# --- Stage 3: 运行时 ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app ./
# 端口与 CMD 由 docker-compose 决定（main 用 3000、preview 用 3001）

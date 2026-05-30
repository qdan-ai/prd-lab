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
RUN pnpm install --frozen-lockfile

# --- Stage 2: 构建 main + preview ---
FROM deps AS builder
COPY . .
RUN pnpm --filter @prd-lab/main build
RUN pnpm --filter @prd-lab/preview build

# --- Stage 3: 运行时 ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app ./
# 端口与 CMD 由 docker-compose 决定（main 用 3000、preview 用 3001）

# Docker 编排（S0 范围）

S0 docker-compose 只起 3 个基础服务：

| 服务 | 宿主机端口 | 容器端口 | 作用 |
|---|---|---|---|
| postgres | 5433 | 5432 | 数据库（避让另一项目占用的 5432） |
| minio | 9100 / 9101 | 9000 / 9001 | 对象存储（避让 9000/9001） |
| nginx | 80 | 80 | 双 host 反代到宿主机 :3000 (app) / :3001 (preview) |

**`apps/main` 和 `apps/preview` 在 dev 阶段跑在宿主机**（`pnpm dev:main` / `pnpm dev:preview`），nginx 用 `host.docker.internal` 反代。这样 Next.js HMR 不受 docker volume 性能影响。容器化部署留到生产 Sprint。

## 首次启动

```bash
# 1. /etc/hosts 加双 host（sudo 一次性）
echo "127.0.0.1  app.local preview.local" | sudo tee -a /etc/hosts

# 2. 起基础服务
pnpm docker:up

# 3. 装依赖 + 跑 migration
pnpm install
pnpm db:migrate

# 4. 起 dev 服务器（开两个终端）
pnpm dev:main      # → 宿主机 :3000，nginx 反代为 http://app.local
pnpm dev:preview   # → 宿主机 :3001，nginx 反代为 http://preview.local
```

访问：
- 主站：http://app.local
- 预览站：http://preview.local
- MinIO Console：http://localhost:9101（minioadmin / minioadmin）
- Postgres：localhost:5433（prdlab / prdlab / prdlab）

## 停止

```bash
pnpm docker:down
```

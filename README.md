# PRD-Lab

> 产品经理的原型 Demo 协作平台 · 版本管理 · 带密码分享 · 在线预览

PM 用 AI 工具（Claude Code 等）生成静态前端原型（一个 zip 包，内含 HTML / CSS / JS），PRD-Lab 负责把它们上传、管理版本、生成带密码的分享链接，让同事或老板在浏览器里直接点开看效果——无需各自部署。

**单机 / 内网部署**：双 host（`app.local` / `preview.local`）隔离 + docker-compose（MySQL + MinIO + nginx）+ 宿主机跑 Next.js。

---

## 三层心智模型

数据这样套娃组织：

```
项目 (Project)          例：「AI 投顾」              ← 一个产品 / 课题
 └─ 方案 (Version)       例：「选好股 4.0」「合规版」   ← 同产品的不同方向
     └─ 版本 (Snapshot)  例：v1 / v2 / "4.0.4"        ← 每次上传产生一个，平等并列
         ├─ 文件清单（zip 解出的 HTML 等）
         └─ 分享链接（snapshot 级绑定）
```

界面三个切换入口：左侧抽屉切「版本」、`Cmd+K` 跨项目跳转、面包屑切快照。

---

## 快速部署

### 1. 配置双 host（不可省）

`app.local` 与 `preview.local` 必须是不同 host，否则原型代码能偷到主站登录 cookie，隔离失效。

```bash
echo "127.0.0.1  app.local preview.local" | sudo tee -a /etc/hosts
```

### 2. 配置环境变量

```bash
cp .env.example .env   # 然后按需填值
```

主要变量：

| 变量 | 说明 | 本地默认 |
|---|---|---|
| `DATABASE_URL` | MySQL 连接串 | `mysql://prdlab:prdlab@localhost:5433/prdlab` |
| `MINIO_ENDPOINT` | 对象存储地址 | `http://localhost:9100` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO 凭证 | `minioadmin` / `minioadmin` |
| `MINIO_BUCKET` | 存储桶名 | `prd-lab` |
| `AUTH_SECRET` | NextAuth 会话签名密钥（`openssl rand -base64 32`） | — |
| `AUTH_TRUST_HOST` | NextAuth 信任反代 host | `true` |
| `HMAC_SECRET` | 预览 token / 分享 cookie 签名密钥（`openssl rand -hex 32`） | — |
| `MAIN_ORIGIN` / `PREVIEW_ORIGIN` | 主站 / 预览站对外 origin | `http://app.local` / `http://preview.local` |
| `AUTH_SHARED_PASSWORD` | 全局统一登入密码门禁；**留空则 dev 豁免**（部署上线务必设置） | 空 |

> 改密码运维：改 `.env` 后重启 `dev:main` / `dev:preview`（env 在 Next 启动时加载，docker 容器不读应用 env）。已签发的 7 天会话继续有效——密码是登入门禁，不是会话校验。

### 3. 起基础设施（docker）

```bash
pnpm docker:up
```

起三个容器：
- **MySQL 5.7** `:5433`（utf8mb4 / 时区 +00:00 / Apple Silicon 经 Rosetta 跑 amd64）
- **MinIO** `:9100`（S3 API）/ `:9101`（控制台，minioadmin/minioadmin）
- **nginx** `:80`（反代 `app.local` → 宿主机 :3000，`preview.local` → :3001）

> nginx 通过 `host.docker.internal` 反代宿主机上的 Next.js，所以 main / preview 跑在宿主机而非容器里。

### 4. 安装依赖 + 迁移数据库

```bash
pnpm install
pnpm db:migrate
```

### 5. 起主站 + 预览站

```bash
pnpm dev:main      # 终端 1 → :3000
pnpm dev:preview   # 终端 2 → :3001
```

打开 http://app.local，输姓名 +（若已设）共享密码进入工作台。

---

## 上传原型

支持**任意静态前端 zip**（单 HTML / SPA / 多页静态站均可），平台按文件清单展示，点击任意文件在新窗口预览。

**GUI 路径**：主站 → `Cmd+K` → 新建项目 → 拖入 zip（或点击选择）。

`index.html` 会自动置顶。点击新窗口预览时有一段跟随真实加载进度的动画。

---

## AI / CLI 调用路径（推荐）

PM 在 Claude Code 里生成原型后，让 AI 直接发版，不必手动点 GUI。

### 安装 prd CLI

```bash
pnpm --filter @prd-lab/prd-cli build
sudo ln -s "$(pwd)/packages/prd-cli/dist/cli.js" /usr/local/bin/prd

prd login    # 浏览器跳到 /cli/auth 点授权，token 落 ~/.prdrc (mode 0600)
prd doctor   # 自诊断：rc / endpoint / token 三项
```

### 常用子命令

```bash
cd ~/path/to/your-demo
prd push --change-note "v1 初版"   # 首次会问 project/version 名字，自动写 .prdrc.json
```

| 命令 | 说明 |
|---|---|
| `prd login` / `whoami` / `doctor` | 鉴权 / 自检 |
| `prd auth list` / `auth revoke <id>` | API token 管理 |
| `prd list projects \| versions <pid> \| snapshots <vid> [--json]` | 列项目 / 方案 / 版本 |
| `prd project \| version \| snapshot create\|rename\|archive` | 各层 CRUD |
| `prd push [dir] [--change-note <t>] [--auto-note] [--json]` | 打包上传，`--json` 返含 snapshot.id 的单行 JSON |
| `prd share create <sid> --random --rotate --json` | 创建分享 + CLI 本地生成 6 位数密码 |
| `prd share list <sid>` / `share revoke <id>` | 分享管理 |
| `prd export <versionId> -o out.zip` | 下载导出 zip |

> CLI 端点默认 `http://app.local`；走 dev :3000 用 `PRD_ENDPOINT=http://localhost:3000 prd ...`。

### Claude Code Skill 接入

主站 `/settings/tokens` 页有「下载 Skill」按钮，下发 zip 含 `SKILL.md` + 对话样例：

```bash
unzip prd-publish-skill.zip -d ~/.claude/skills/
```

装好重启 Claude Code，直接说自然语言（例如「把这个 demo 推到 PRD-Lab，老板要看」），Claude 会按 SKILL.md 自动跑：列项目让你选 → `prd push --json` → `prd share create --random --rotate --json` → 把链接 + 密码回给你。

> token 仅从 `~/.prdrc` 读，**不要**写进 SKILL.md 或仓库（防泄漏）。同 sha256 二次 push 命中 24h Idempotency-Key，不重复创建。

---

## 个人设置 / Token 管理

主站登入后右上角头像 → 个人设置 → `/settings/tokens`：看 / 创建 / 撤销 API token，下载 Claude Code Skill。

---

## 故障排查

| 症状 | 修法 |
|---|---|
| 访问 IP / localhost 显示 nginx 提示页 | 用 `app.local` / `preview.local` 访问；确认 `/etc/hosts` 已加 |
| `prd login` 浏览器没跳 | 手动复制终端打印的 `http://app.local/cli/auth?cb=...` 到浏览器 |
| `prd push` endpoint 不可达 | `prd doctor` 查；或 `PRD_ENDPOINT=http://localhost:3000 prd push` |
| `prd push` 401 | token 失效；`prd login` 重新授权 |
| 上传后原型加载不出来 | 检查预览站 `curl http://preview.local`；`docker compose ps` 看容器 |
| Claude Code 不触发 Skill | 确认 `~/.claude/skills/prd-publish/SKILL.md` 存在，重启 Claude Code |

---

## 技术栈

- **Next.js 16**（App Router）+ TypeScript + **Drizzle ORM** + **MySQL 5.7**
- **MinIO**（S3 兼容对象存储）· **NextAuth v5**（NameProvider 姓名唯一登入 + 统一密码门禁）
- shadcn/ui + Tailwind v4 · **pnpm@10 workspaces** · esbuild（CLI 打包）

仓库结构：

```
apps/
  main/        Next.js :3000  主站 UI + REST + Server Actions
  preview/     Next.js :3001  静态资产代理 + cookie 鉴权
packages/
  core/        db(schema/迁移) + hmac-token + s3 + zip-utils + api-token 等
  prd-cli/     单 bin：prd（cac 子命令）
docker/        docker-compose.yml + nginx.conf
```

---

## 常用命令

```bash
pnpm dev:main           # 主站 :3000
pnpm dev:preview        # 预览 :3001
pnpm build              # 全量构建
pnpm db:generate        # 生成迁移
pnpm db:migrate         # 应用迁移
pnpm docker:up | down | logs
```

## License

Internal use.

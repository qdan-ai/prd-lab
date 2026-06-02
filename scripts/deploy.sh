#!/usr/bin/env bash
# scripts/deploy.sh -- 把本地 HEAD 部署到火山云试用环境（101.96.194.178）
#
# 链路:
#   1. 本地 git archive HEAD -> tar.gz
#   2. scp 到服务器 /opt/prd-lab/
#   3. ssh 进服务器: 解压 -> docker compose build (带 --env-file) -> recreate main/preview
#      -> docker exec nginx reload -> [可选] db:migrate -> [可选] docker prune
#      -> 健康检查 curl 主站 + 预览站
#   4. stdout 提示团队成员硬刷新（旧 server action ID 会触发 500）
#
# 规避的历史踩坑（详见 ai/KNOWLEDGE.md）:
#   R16 -- 所有 ssh/scp 加 ServerAliveInterval=30 防 sshd idle timeout 单方断连
#   R17 -- docker recreate 后必须 nginx -s reload，否则 nginx 缓存旧 upstream IP -> 502
#   R18 -- NEXT_PUBLIC_* 是 build time inline，必须等 build 阶段才能注入
#   R19 -- 部署后旧浏览器持有失效的 server action ID 会让 login 500，必须通知硬刷新
#   R20 -- compose 与 .env 不在同目录时必须 --env-file 显式传，否则 ${VAR:-default} 静默 fallback
#
# 用法:
#   ./scripts/deploy.sh                 # 标准部署
#   ./scripts/deploy.sh --migrate       # 部署 + 跑 schema migration
#   ./scripts/deploy.sh --force         # 允许带 unstaged 改动
#   ./scripts/deploy.sh --skip-prune    # 跳过 docker prune（紧急部署用）
#   ./scripts/deploy.sh --dry-run       # 只打印将要执行的步骤、不真的执行
#
# 环境变量（DEPLOY_PASS 必须由调用方提供，不在脚本中硬编码 -- R7 守约）:
#   DEPLOY_HOST   默认 101.96.194.178（试用环境）
#   DEPLOY_USER   默认 root
#   DEPLOY_PASS   必填，从 ai/DEPLOYMENT.md 查或 shell 内 export 后调用
#                 推荐: source <(grep '^DEPLOY_PASS=' ~/.prdlab.env) && ./scripts/deploy.sh
#   REMOTE_ROOT   默认 /opt/prd-lab

set -euo pipefail

# ─── 配置 ───────────────────────────────────────────────
DEPLOY_HOST="${DEPLOY_HOST:-101.96.194.178}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PASS="${DEPLOY_PASS:-}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/prd-lab}"
SSH_OPTS="-o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o StrictHostKeyChecking=accept-new"
LOCAL_TAR="/tmp/prd-lab-deploy-$(date +%s).tar.gz"
COMPOSE_FILE="docker-compose.prod.yml"

# ─── flag 解析 ──────────────────────────────────────────
WITH_MIGRATE=0
FORCE=0
SKIP_PRUNE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --migrate)    WITH_MIGRATE=1 ;;
    --force)      FORCE=1 ;;
    --skip-prune) SKIP_PRUNE=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "✗ 未知参数: $arg（--help 看用法）" >&2
      exit 2
      ;;
  esac
done

# ─── helpers ────────────────────────────────────────────
log()  { printf "\033[36m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$*" >&2; }
err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }

run_or_print() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf "  [dry-run] %s\n" "$*"
  else
    eval "$*"
  fi
}

cleanup() {
  if [[ -f "$LOCAL_TAR" ]]; then
    rm -f "$LOCAL_TAR"
  fi
}
trap cleanup EXIT

# ─── 0. 前置检查 ────────────────────────────────────────
log "前置检查"

# 必须在仓库根
if [[ ! -f "package.json" ]] || [[ ! -d "docker" ]] || [[ ! -d "apps/main" ]]; then
  err "请在仓库根目录运行此脚本（当前: $(pwd)）"
  exit 1
fi

# 依赖工具
for cmd in git sshpass scp ssh tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "缺少命令: $cmd"
    [[ "$cmd" == "sshpass" ]] && err "  macOS 安装: brew install hudochenkov/sshpass/sshpass"
    exit 1
  fi
done

# 工作区干净度
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  if [[ "$FORCE" -eq 1 ]]; then
    warn "工作区有未 commit 改动，--force 已指定，继续（注意 git archive 只打 HEAD）"
  else
    err "工作区有未 commit 改动；git archive 只会打包 HEAD，请先 commit 或加 --force"
    git status --short
    exit 1
  fi
fi

# DEPLOY_PASS 强校验：脚本不再硬编码密码（R7 守约 -- 机密不进代码仓）
if [[ -z "$DEPLOY_PASS" && "$DRY_RUN" -eq 0 ]]; then
  err "DEPLOY_PASS 未设置；从 ai/DEPLOYMENT.md 复制后用如下方式运行："
  err "  DEPLOY_PASS='<服务器密码>' ./scripts/deploy.sh"
  err "  或者本地建 ~/.prdlab.env 含 DEPLOY_PASS=xxx 然后 source 后调用"
  exit 1
fi

ok "前置检查通过（host=$DEPLOY_HOST, root=$REMOTE_ROOT, migrate=$WITH_MIGRATE, prune=$([ $SKIP_PRUNE -eq 0 ] && echo on || echo off)）"

# ─── 1. 本地打包 ────────────────────────────────────────
log "本地打包: git archive HEAD -> $LOCAL_TAR"
if [[ "$DRY_RUN" -eq 0 ]]; then
  git archive HEAD --format=tar.gz -o "$LOCAL_TAR"
  ok "$(du -h "$LOCAL_TAR" | awk '{print $1}') -> $LOCAL_TAR"
else
  printf "  [dry-run] git archive HEAD --format=tar.gz -o %s\n" "$LOCAL_TAR"
fi

# ─── 2. scp 推到服务器 ──────────────────────────────────
log "scp -> $DEPLOY_USER@$DEPLOY_HOST:$REMOTE_ROOT/"
if [[ "$DRY_RUN" -eq 0 ]]; then
  sshpass -p "$DEPLOY_PASS" scp $SSH_OPTS "$LOCAL_TAR" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_ROOT/prd-lab-deploy.tar.gz"
  ok "tarball 已推送"
else
  printf "  [dry-run] sshpass -p ***** scp %s ... %s:%s/\n" "$LOCAL_TAR" "$DEPLOY_HOST" "$REMOTE_ROOT"
fi

# ─── 3. 服务器端执行 ────────────────────────────────────
log "ssh -> 服务器端部署链"

# 把所有服务器端命令拼成一个 heredoc，单连接执行避免多次 SSH 握手
# 注意: 远端 set -e 失败立即退出；本地 ssh exit code 透传
REMOTE_SCRIPT=$(cat <<EOF_REMOTE
set -euo pipefail

cd "$REMOTE_ROOT"

echo "▸ 解压覆盖 repo/"
mkdir -p repo
tar -xzf prd-lab-deploy.tar.gz -C repo
rm prd-lab-deploy.tar.gz

# .env 在 repo 根，必须存在；不存在直接退出（首次部署看 DEPLOYMENT.md）
if [[ ! -f repo/.env ]]; then
  echo "✗ repo/.env 不存在；首次部署请按 DEPLOYMENT.md 手工创建"
  exit 1
fi

cd repo/docker

echo "▸ docker compose build main（带 --env-file ../.env，R20 防 NEXT_PUBLIC_* 漏注入）"
docker compose -f $COMPOSE_FILE --env-file ../.env build main

echo "▸ recreate main + preview"
docker compose -f $COMPOSE_FILE --env-file ../.env up -d --force-recreate main preview

# R17 -- recreate 后必须 reload nginx
echo "▸ nginx -s reload（R17 防 502）"
docker exec prd-lab-nginx nginx -s reload

if [[ "$WITH_MIGRATE" -eq 1 ]]; then
  echo "▸ 跑 schema migration"
  docker compose -f $COMPOSE_FILE --env-file ../.env exec -T main pnpm --filter @prd-lab/core db:migrate
fi

if [[ "$SKIP_PRUNE" -eq 0 ]]; then
  echo "▸ docker prune（共享 ECS 安全模式：只删 dangling + 自家 untagged 旧 image + buildkit cache 裁到 1GB）"
  # 共享机器（finance-ingest / rsshub 共存），不能 prune -a 否则会误删别人的 image
  # 只删 dangling（没 tag 也没 container 引用的孤儿层）+ 自家旧 untagged
  docker image prune -f || true
  # 找自家旧的 untagged prd-lab-app image（recreate 后被替换的旧 image 会变 <none>:<none>）
  docker images --filter "dangling=true" --filter "label=app=prd-lab" -q | xargs -r docker rmi || true
  # buildkit cache：用 --keep-storage 按 LRU 裁到 1GB
  # （历史踩坑：--filter until=24h 看的是 LAST USED 距今，每次 deploy 都把 cache 摸成"刚用过"，
  #  时间窗永远满足不了，结果 cache 无限累积；2026-06-02 实测 5.2G 不被清；换 keep-storage 解决）
  docker builder prune -af --keep-storage 1GB || true
fi

echo "▸ 健康检查"
sleep 3  # nginx reload 后给 upstream 一点重连时间

# 主站: 未登录访问 / 会 redirect 到 /login，2xx 或 3xx 都算正常
MAIN_CODE=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost/ || echo "000")
PREVIEW_CODE=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8081/ || echo "000")
echo "  主站 http://localhost/      -> \$MAIN_CODE"
echo "  预览 http://localhost:8081/ -> \$PREVIEW_CODE"

# 2xx 或 3xx 都接受；4xx (尤其 4 系列 auth redirect) 也可以；5xx 拒绝
if [[ "\$MAIN_CODE" =~ ^[23] ]] && [[ "\$PREVIEW_CODE" =~ ^[23] ]]; then
  echo "✓ 健康检查通过"
elif [[ "\$MAIN_CODE" == "4"* ]] || [[ "\$PREVIEW_CODE" == "4"* ]]; then
  echo "⚠ 健康检查返回 4xx，可能是 auth redirect，请人工 curl 确认（exit 0）"
else
  echo "✗ 健康检查失败 main=\$MAIN_CODE preview=\$PREVIEW_CODE"
  echo "  排查: docker compose -f $COMPOSE_FILE ps; docker compose -f $COMPOSE_FILE logs --tail 100 main"
  exit 1
fi

echo "▸ 磁盘水位"
df -h / | awk 'NR<=2'

EOF_REMOTE
)

if [[ "$DRY_RUN" -eq 0 ]]; then
  sshpass -p "$DEPLOY_PASS" ssh $SSH_OPTS "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_SCRIPT"
else
  printf "  [dry-run] ssh %s <<远端脚本约 %d 行>>\n" "$DEPLOY_HOST" "$(echo "$REMOTE_SCRIPT" | wc -l)"
fi

# ─── 4. 收尾提示 ────────────────────────────────────────
echo ""
ok "部署完成"
echo ""
cat <<'POST_TIPS'
═══════════════════════════════════════════════════════════════════
⚠️  请在团队群通知所有已开 PRD-Lab 页面的成员硬刷新浏览器：
    macOS:   Cmd + Shift + R
    Windows: Ctrl + F5
理由: 重新部署后 Next.js server action ID 会变化，旧页面提交时会触发
"Failed to find Server Action..."，next-auth 兜底成 CredentialsSignin
表现为登录失败（已通过 login server action try/catch 兜底为友好提示，
但仍建议刷新避免其他 server action 触发同类问题）。
═══════════════════════════════════════════════════════════════════
POST_TIPS

echo ""
echo "线上入口:"
echo "  主站: http://$DEPLOY_HOST"
echo "  预览: http://$DEPLOY_HOST:8081"

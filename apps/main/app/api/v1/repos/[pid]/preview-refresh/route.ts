import { issueRepoToken, PREVIEW_HANDOFF_TTL_SECONDS } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { requestOrigin } from "@/lib/api/request-origin";
import { sanitizeRepoNextPath } from "@/lib/preview/sanitize-next";
import { previewOrigin, requireReadableRepo } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * GET /api/v1/repos/:pid/preview-refresh?next=/r/:pid/…
 *
 * 主人侧自动重签落点：预览站仓库会话过期后 document 导航 302 到这里，校验登录与可读性后
 * 重签 300s 交接令牌弹回预览站。口径同 /api/v1/snapshots/:sid/preview-refresh。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const url = new URL(request.url);
  const session = await getSession();
  if (!session) {
    const publicHref = `${requestOrigin(request)}${url.pathname}${url.search}`;
    return redirect(`${requestOrigin(request)}/login?callbackUrl=${encodeURIComponent(publicHref)}`);
  }
  const repo = await requireReadableRepo(pid, session);
  if (repo instanceof Response) return text(404, "该项目不存在或无权访问");

  const next = sanitizeRepoNextPath(url.searchParams.get("next"), repo.id);
  const token = issueRepoToken(
    { repoId: repo.id, sessionUserId: session.userId, origin: requestOrigin(request) },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  return redirect(`${previewOrigin()}${next}${next.includes("?") ? "&" : "?"}token=${token}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

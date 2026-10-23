import { errorResponse } from "@/lib/api/errors";
import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { projectReadableBy } from "@prd-lab/core";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  issueToken,
  projects,
  snapshotInAudience,
  snapshots,
  versions,
  PREVIEW_HANDOFF_TTL_SECONDS,
} from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { sanitizeNextPath } from "@/lib/preview/sanitize-next";
import { requestOrigin } from "@/lib/api/request-origin";

/**
 * GET /api/v1/snapshots/:sid/preview-refresh?next=/p/:sid/xxx.html
 *
 * S20 owner 侧自动重签落点：预览站会话 token 过期后，document 导航 302 到这里，
 * 校验完 session + 可读性重新签一枚 300s 交接 token，再 302 弹回预览站。
 *
 * 这是 document 导航（不是 XHR），所以一律返 302 / 简短文本，不返 JSON error 体。
 * 未登入 → 302 去 /login?callbackUrl=<本 URL>，登录后自动续完整条链路。
 */
export async function GET(request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const url = new URL(request.url);
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) {
    // callbackUrl 用浏览器视角 origin 重组（standalone 下 url.href 是 0.0.0.0:3000 内部地址）
    const publicHref = `${requestOrigin(request)}${url.pathname}${url.search}`;
    return redirect(`${requestOrigin(request)}/login?callbackUrl=${encodeURIComponent(publicHref)}`);
  }

  // 可读性校验：口径与同目录 preview-token POST 完全一致
  const rows = await db
    .select({
      visibility: projects.visibility,
      ownerId: projects.ownerId,
      archivedAt: snapshots.archivedAt,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(snapshots.id, sid),
        isNull(versions.archivedAt),
        projectReadableBy(session.userId),
        snapshotInAudience("guest"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return text(404, "该版本不存在或无权访问");
  if (row.archivedAt !== null) return text(409, "该版本已被删除");

  const next = sanitizeNextPath(url.searchParams.get("next"), sid);
  const token = issueToken(
    { snapshotId: sid, sessionUserId: session.userId, origin: requestOrigin(request) },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  const previewOrigin = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? "http://preview.local";
  return redirect(`${previewOrigin}${next}${next.includes("?") ? "&" : "?"}token=${token}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

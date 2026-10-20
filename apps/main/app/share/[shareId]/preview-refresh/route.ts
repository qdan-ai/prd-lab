import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  issueRepoShareToken,
  issueShareToken,
  shareSessionId,
  snapshotInAudience,
  snapshots,
  PREVIEW_HANDOFF_TTL_SECONDS,
} from "@prd-lab/core";
import { repoProjectIdOfVersion } from "@prd-lab/core/repo";
import { getShareSession } from "@/lib/share/share-session";
import { requestOrigin } from "@/lib/api/request-origin";
import { sanitizeNextPath, sanitizeRepoNextPath } from "@/lib/preview/sanitize-next";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * GET /share/:shareId/preview-refresh?sid=<snapshotId>&next=/p/<sid>/xxx.html
 *
 * S20 访客侧自动重签落点：预览站会话 token 过期后，document 导航 302 到这里，
 * 校验完 share session + snapshot 归属重新签一枚 300s 交接 token，再 302 弹回预览站。
 *
 * 任何不通过（session invalid/revoked/not_found、sid 不属于本方案或已归档）一律
 * 302 回 `/share/{shareId}`：分享页 SSR 自会呈现密码页 / 410 等状态，
 * 且响应不区分失败原因（防枚举）。
 *
 * 仓库查看器（预览站 /r/<pid>）走同一端点，参数换成 `rid=<pid>`、`next=/r/<pid>/…`：
 * 校验链接绑定的正是该仓库的系统方案后签仓库级令牌。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const sharePage = `/share/${shareId}`;

  const session = await getShareSession(shareId);
  if (session.kind !== "ok") return redirect(sharePage);

  const url = new URL(request.url);
  const rid = url.searchParams.get("rid");
  if (rid) {
    if ((await repoProjectIdOfVersion(session.versionId)) !== rid) return redirect(sharePage);
    const next = sanitizeRepoNextPath(url.searchParams.get("next"), rid);
    const token = issueRepoShareToken(
      {
        repoId: rid,
        shareSessionId: shareSessionId(shareId, session.pv),
        origin: requestOrigin(request),
      },
      PREVIEW_HANDOFF_TTL_SECONDS,
    );
    const previewOrigin = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? "http://preview.local";
    return redirect(`${previewOrigin}${next}${next.includes("?") ? "&" : "?"}token=${token}`);
  }

  const sid = url.searchParams.get("sid");
  if (!sid) return redirect(sharePage);

  // 归属校验：sid ∈ 本方案的活跃 snapshot（口径同 api/preview-token POST）
  const rows = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.id, sid),
        eq(snapshots.versionId, session.versionId),
        isNull(snapshots.archivedAt),
        snapshotInAudience("guest"),
      ),
    )
    .limit(1);
  if (!rows[0]) return redirect(sharePage);

  const next = sanitizeNextPath(url.searchParams.get("next"), sid);
  const token = issueShareToken(
    {
      snapshotId: sid,
      shareSessionId: shareSessionId(shareId, session.pv),
      origin: requestOrigin(request),
    },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  const previewOrigin = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? "http://preview.local";
  return redirect(`${previewOrigin}${next}${next.includes("?") ? "&" : "?"}token=${token}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

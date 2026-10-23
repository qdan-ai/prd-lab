import { sharedSnapshotAvailable } from "@/lib/share/snapshot-access";
import { shareResponse } from "@/lib/share/response";
import { and, eq } from "drizzle-orm";
import {
  db,
  issueShareToken,
  issueToken,
  shareSessionId,
  snapshots,
  PREVIEW_HANDOFF_TTL_SECONDS,
} from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";
import { requestOrigin } from "@/lib/api/request-origin";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * POST /share/[shareId]/api/preview-token
 *
 * S19 方案级：snapshotId 必须属于 share 绑定的 version 且未归档（归属校验替代 S8 的恒等比较）。
 * 不属于 / 已归档一律 not_found（防枚举；单版本归档 ≠ 分享失效）。
 * sub = `${shareId}:${pv}`，密码重置后 pv 改变 → 旧 token sub 失效。
 * S20：签发 300s 交接 token 且 payload 带 origin，供预览站会话过期后 302 回
 * `/share/{shareId}/preview-refresh` 自动重签。
 */
export async function POST(request: Request, ctx: Ctx) {
  return shareResponse(() => handle(request, ctx));
}

async function handle(request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
  if (session.kind === "unauthorized") return errorResponse("unauthorized");
  if (session.kind === "forbidden") return errorResponse("not_found");
  if (session.kind === "revoked") return errorResponse("share_revoked");
  if (session.kind === "not_found") return errorResponse("share_not_found");
  if (session.kind === "invalid") return errorResponse("unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse("validation_error", "body must be JSON");
  }
  const sid = (body as Record<string, unknown>).snapshotId;
  if (typeof sid !== "string" || !sid) {
    return errorResponse("validation_error", "snapshotId required");
  }

  // 归属校验：sid ∈ 本方案的活跃 snapshot
  const rows = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.id, sid),
        eq(snapshots.versionId, session.versionId),
        sharedSnapshotAvailable(),
      ),
    )
    .limit(1);
  if (!rows[0]) return errorResponse("not_found");

  const token = session.userId ? issueToken(
    { snapshotId: sid, sessionUserId: session.userId, origin: requestOrigin(request) },
    PREVIEW_HANDOFF_TTL_SECONDS,
  ) : issueShareToken(
    {
      snapshotId: sid,
      shareSessionId: shareSessionId(shareId, session.pv),
      origin: requestOrigin(request),
    },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  return Response.json({ token, expiresIn: PREVIEW_HANDOFF_TTL_SECONDS });
}

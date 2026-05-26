import { eq } from "drizzle-orm";
import { db, issueShareToken, shareSessionId, snapshots } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * POST /share/[shareId]/api/preview-token
 *
 * S8：snapshotId 必须等于 session.snapshotId（share 绑定快照）。父窗口 4min 周期续签。
 * sub = `${shareId}:${pv}`，密码重置后 pv 改变 → 旧 token sub 失效。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
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
  if (sid !== session.snapshotId) return errorResponse("not_found");

  // 校 snapshot 未 archive
  const rows = await db
    .select({ id: snapshots.id, archivedAt: snapshots.archivedAt })
    .from(snapshots)
    .where(eq(snapshots.id, sid))
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  if (row.archivedAt !== null) return errorResponse("share_revoked", "snapshot archived");

  const token = issueShareToken(
    {
      snapshotId: sid,
      shareSessionId: shareSessionId(shareId, session.pv),
    },
    300,
  );
  return Response.json({ token, expiresIn: 300 });
}

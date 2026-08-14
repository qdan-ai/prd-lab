import { and, eq, isNull } from "drizzle-orm";
import { db, issueShareToken, shareSessionId, snapshots } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * POST /share/[shareId]/api/preview-token
 *
 * S19 方案级：snapshotId 必须属于 share 绑定的 version 且未归档（归属校验替代 S8 的恒等比较）。
 * 不属于 / 已归档一律 not_found（防枚举；单版本归档 ≠ 分享失效）。
 * sub = `${shareId}:${pv}`，密码重置后 pv 改变 → 旧 token sub 失效。父窗口 4min 周期续签。
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

  // 归属校验：sid ∈ 本方案的活跃 snapshot
  const rows = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.id, sid),
        eq(snapshots.versionId, session.versionId),
        isNull(snapshots.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) return errorResponse("not_found");

  const token = issueShareToken(
    {
      snapshotId: sid,
      shareSessionId: shareSessionId(shareId, session.pv),
    },
    300,
  );
  return Response.json({ token, expiresIn: 300 });
}

import { eq } from "drizzle-orm";
import { annotationLinks, db } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * GET /share/[shareId]/api/annotations?snapshotId={sid}
 *
 * S8：访客侧标注；snapshotId 必须等于 session.snapshotId（share 绑定的快照）。
 * 返同 owner 侧 `/api/v1/snapshots/[sid]/annotations` shape：{annotations, revision, source}。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
  if (session.kind === "revoked") return errorResponse("share_revoked");
  if (session.kind === "not_found") return errorResponse("share_not_found");
  if (session.kind === "invalid") return errorResponse("unauthorized");

  const url = new URL(request.url);
  const sid = url.searchParams.get("snapshotId");
  if (!sid) return errorResponse("validation_error", "snapshotId required");
  if (sid !== session.snapshotId) return errorResponse("not_found");

  const links = await db
    .select({
      dataJsonb: annotationLinks.dataJsonb,
      revision: annotationLinks.revision,
      source: annotationLinks.source,
    })
    .from(annotationLinks)
    .where(eq(annotationLinks.snapshotId, sid))
    .limit(1);
  const link = links[0];
  if (!link) {
    return Response.json({ annotations: [], revision: 0, source: "platform" });
  }
  const data = (link.dataJsonb as { annotations?: unknown[] }) || {};
  return Response.json({
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    revision: link.revision,
    source: link.source,
  });
}

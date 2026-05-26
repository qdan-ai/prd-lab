import { eq } from "drizzle-orm";
import { db, snapshots, users, versions } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * GET /share/[shareId]/api/version
 *
 * S8：share 绑 snapshot 级；返回该 share 锁定 snapshot 的元数据。
 */
export async function GET(_request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
  if (session.kind === "revoked") return errorResponse("share_revoked");
  if (session.kind === "not_found") return errorResponse("share_not_found");
  if (session.kind === "invalid") return errorResponse("unauthorized");

  const rows = await db
    .select({
      id: snapshots.id,
      versionId: snapshots.versionId,
      seqNo: snapshots.seqNo,
      versionLabel: snapshots.versionLabel,
      changeNote: snapshots.changeNote,
      createdAt: snapshots.createdAt,
      archivedAt: snapshots.archivedAt,
      uploaderName: users.name,
      entryHtmlPath: snapshots.entryHtmlPath,
    })
    .from(snapshots)
    .innerJoin(users, eq(snapshots.uploaderId, users.id))
    .where(eq(snapshots.id, session.snapshotId))
    .limit(1);
  const snap = rows[0];
  if (!snap) return errorResponse("not_found");
  if (snap.archivedAt !== null) return errorResponse("share_revoked", "snapshot archived");

  const verRows = await db
    .select({ versionName: versions.name })
    .from(versions)
    .where(eq(versions.id, snap.versionId))
    .limit(1);

  return Response.json({
    snapshotId: snap.id,
    versionName: verRows[0]?.versionName ?? "",
    seqNo: snap.seqNo,
    versionLabel: snap.versionLabel,
    changeNote: snap.changeNote,
    uploaderName: snap.uploaderName,
    createdAt: snap.createdAt,
    entryHtmlPath: snap.entryHtmlPath,
  });
}

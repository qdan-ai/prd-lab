import { asc, eq, sql } from "drizzle-orm";
import { db, snapshotFiles, snapshots } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * GET /share/[shareId]/api/files
 *
 * 访客侧：返回 share 绑定 snapshot 的文件清单。
 * 排序：entry HTML 永远第一位，其余按 relPath 字母序。
 */
export async function GET(_: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
  if (session.kind === "revoked") return errorResponse("share_revoked");
  if (session.kind === "not_found") return errorResponse("share_not_found");
  if (session.kind === "invalid") return errorResponse("unauthorized");

  const snap = await db
    .select({
      id: snapshots.id,
      archivedAt: snapshots.archivedAt,
      entryHtmlPath: snapshots.entryHtmlPath,
    })
    .from(snapshots)
    .where(eq(snapshots.id, session.snapshotId))
    .limit(1);
  if (!snap[0]) return errorResponse("not_found");
  if (snap[0].archivedAt !== null) return errorResponse("share_revoked", "snapshot archived");

  const files = await db
    .select({
      relPath: snapshotFiles.relPath,
      contentType: snapshotFiles.contentType,
      sizeBytes: snapshotFiles.sizeBytes,
      sha256: snapshotFiles.sha256,
    })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, session.snapshotId))
    .orderBy(
      sql`CASE WHEN ${snapshotFiles.relPath} = ${snap[0].entryHtmlPath} THEN 0 ELSE 1 END`,
      asc(snapshotFiles.relPath),
    );

  return Response.json({ files });
}

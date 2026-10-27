import { sharedSnapshotAvailable } from "@/lib/share/snapshot-access";
import { shareResponse } from "@/lib/share/response";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, snapshotFiles, snapshots } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * GET /share/[shareId]/api/files?sid={snapshotId}
 *
 * S19 方案级：`sid` 指定方案内某个活跃 snapshot；缺省 = 最新活跃。
 * 归属校验：sid 必须属于 share 绑定的 version 且未归档，否则 not_found。
 * 排序：entry HTML 永远第一位，其余按 relPath 字母序。
 */
export async function GET(request: Request, ctx: Ctx) {
  return shareResponse(() => handle(request, ctx));
}

async function handle(request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
  if (session.kind === "revoked") return errorResponse("share_revoked");
  if (session.kind === "not_found") return errorResponse("share_not_found");
  if (session.kind === "invalid") return errorResponse("unauthorized");

  const sid = new URL(request.url).searchParams.get("sid");

  const snap = await db
    .select({
      id: snapshots.id,
      entryHtmlPath: snapshots.entryHtmlPath,
    })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.versionId, session.versionId),
        sharedSnapshotAvailable(),
        ...(sid ? [eq(snapshots.id, sid)] : []),
      ),
    )
    .orderBy(desc(snapshots.seqNo))
    .limit(1);
  if (!snap[0]) return errorResponse("not_found");

  const files = await db
    .select({
      relPath: snapshotFiles.relPath,
      contentType: snapshotFiles.contentType,
      sizeBytes: snapshotFiles.sizeBytes,
      sha256: snapshotFiles.sha256,
    })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, snap[0].id))
    .orderBy(
      sql`CASE WHEN ${snapshotFiles.relPath} = ${snap[0].entryHtmlPath} THEN 0 ELSE 1 END`,
      asc(snapshotFiles.relPath),
    );

  return Response.json({ files });
}

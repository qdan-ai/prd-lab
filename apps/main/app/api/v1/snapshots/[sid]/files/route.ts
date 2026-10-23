import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { projectReadableBy } from "@prd-lab/core";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, projects, snapshotFiles, snapshotInAudience, snapshots, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ sid: string }> };

/**
 * GET /api/v1/snapshots/:sid/files
 *
 * S9：返回 snapshot 的所有文件清单（path/contentType/size/sha256），用于版本页中央文件列表。
 * team 项目任意登入用户可读；private 项目仅创建者/有效仓库成员可读。archived snapshot → 410 snapshot_archived。
 * 排序：entry HTML 永远第一位，其余按 relPath 字母序。
 */
export async function GET(_: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const rows = await db
    .select({
      visibility: projects.visibility,
      ownerId: projects.ownerId,
      archivedAt: snapshots.archivedAt,
      entryHtmlPath: snapshots.entryHtmlPath,
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
  if (!row) return errorResponse("not_found");
  if (row.archivedAt !== null) return errorResponse("snapshot_archived");

  const files = await db
    .select({
      relPath: snapshotFiles.relPath,
      contentType: snapshotFiles.contentType,
      sizeBytes: snapshotFiles.sizeBytes,
      sha256: snapshotFiles.sha256,
    })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, sid))
    .orderBy(
      sql`CASE WHEN ${snapshotFiles.relPath} = ${row.entryHtmlPath} THEN 0 ELSE 1 END`,
      asc(snapshotFiles.relPath),
    );

  return Response.json({ files });
}

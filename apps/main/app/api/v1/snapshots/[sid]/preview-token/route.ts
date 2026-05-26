import { and, eq, isNull } from "drizzle-orm";
import { db, issueToken, projects, snapshots, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

/**
 * POST /api/v1/snapshots/:sid/preview-token
 * 父窗口周期续签（每 4 分钟）。返回新 token + 过期秒数。
 */
export async function POST(_: Request, { params }: { params: Promise<{ sid: string }> }) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  // 校验可读
  const rows = await db
    .select({
      visibility: projects.visibility,
      ownerId: projects.ownerId,
      archivedAt: snapshots.archivedAt,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  const canRead = row.visibility === "team" || row.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");
  if (row.archivedAt !== null) return errorResponse("snapshot_archived");

  const token = issueToken({ snapshotId: sid, sessionUserId: session.userId }, 300);
  return Response.json({ token, expiresIn: 300 });
}

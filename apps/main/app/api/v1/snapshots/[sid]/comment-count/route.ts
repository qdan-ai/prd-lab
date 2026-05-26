import { and, eq, isNull, sql } from "drizzle-orm";
import { comments, db, projects, snapshots, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ sid: string }> };

/**
 * GET /api/v1/snapshots/:sid/comment-count
 *
 * 删除快照二次确认 modal 用：返回该 snapshot 上的评论总数（不区分 resolved，不过滤 archived）。
 * docs/02 §2.2 删除二次确认显示"关联 N 条评论将变只读历史"需要总数；archived 后 count 保持不变是预期。
 */
export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const rows = await db
    .select({
      visibility: projects.visibility,
      ownerId: projects.ownerId,
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

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.snapshotIdAtComment, sid));

  return Response.json({ count: countRows[0]?.count ?? 0 });
}

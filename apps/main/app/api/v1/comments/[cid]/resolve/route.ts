import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { comments, db, projects, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ cid: string }> };

/**
 * POST /api/v1/comments/:cid/resolve
 * body: { undo?: boolean }
 *
 * 任何能 read 该评论所属项目的用户均可 resolve / undo。
 *
 * 并发原子性：用 SQL WHERE 子句区分（resolved_at IS NULL ↔ NOT NULL），
 * UPDATE 影响行数 = 0 时返 409 `comment_resolved_already`。
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { cid } = await params;

  let undo = false;
  if (request.headers.get("content-length") !== "0") {
    try {
      const body = (await request.json()) as Record<string, unknown> | null;
      if (body && typeof body === "object" && body.undo === true) undo = true;
    } catch {
      // 空 body 或 invalid JSON 都按 undo=false 处理
    }
  }

  // 读权限校验（同时拿 versionId 配合 cache key invalidation）
  const rows = await db
    .select({
      id: comments.id,
      visibility: projects.visibility,
      ownerId: projects.ownerId,
      versionId: comments.versionId,
    })
    .from(comments)
    .innerJoin(versions, eq(comments.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(comments.id, cid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  const canRead = row.visibility === "team" || row.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");

  if (undo) {
    const updated = await db
      .update(comments)
      .set({ resolvedAt: null })
      .where(and(eq(comments.id, cid), isNotNull(comments.resolvedAt)))
      .returning({ id: comments.id, resolvedAt: comments.resolvedAt });
    const first = updated[0];
    if (!first) return errorResponse("comment_resolved_already", "already unresolved");
    return Response.json({ comment: { id: first.id, resolved_at: null } });
  }

  const updated = await db
    .update(comments)
    .set({ resolvedAt: new Date() })
    .where(and(eq(comments.id, cid), isNull(comments.resolvedAt)))
    .returning({ id: comments.id, resolvedAt: comments.resolvedAt });
  const first = updated[0];
  if (!first) return errorResponse("comment_resolved_already", "already resolved");
  return Response.json({ comment: { id: first.id, resolved_at: first.resolvedAt } });
}

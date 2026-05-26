import { and, eq, isNull } from "drizzle-orm";
import { comments, db, projects, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ cid: string }> };

/** 加载评论 + 项目 owner_id（评论必须挂在活跃 version + project 下才能改） */
async function loadComment(cid: string) {
  const rows = await db
    .select({
      id: comments.id,
      authorUserId: comments.authorUserId,
      content: comments.content,
      anchorKind: comments.anchorKind,
      versionId: comments.versionId,
      ownerId: projects.ownerId,
    })
    .from(comments)
    .innerJoin(versions, eq(comments.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(comments.id, cid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * PATCH /api/v1/comments/:cid
 * body: { content }
 *
 * 仅作者本人可改 content。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { cid } = await params;

  const row = await loadComment(cid);
  if (!row) return errorResponse("not_found");
  if (row.authorUserId !== session.userId) return errorResponse("not_author");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  if (!body || typeof body !== "object")
    return errorResponse("validation_error", "body must be JSON object");
  const b = body as Record<string, unknown>;
  if (typeof b.content !== "string" || !b.content.trim())
    return errorResponse("validation_error", "content required non-empty string");
  if (b.content.length > 5000)
    return errorResponse("validation_error", "content too long (>5000)");

  const updatedRows = await db
    .update(comments)
    .set({ content: b.content })
    .where(eq(comments.id, cid))
    .returning({
      id: comments.id,
      content: comments.content,
      anchorKind: comments.anchorKind,
      createdAt: comments.createdAt,
      resolvedAt: comments.resolvedAt,
    });
  const updated = updatedRows[0];
  if (!updated) return errorResponse("not_found");

  return Response.json({
    comment: {
      id: updated.id,
      content: updated.content,
      anchor_kind: updated.anchorKind,
      created_at: updated.createdAt,
      resolved_at: updated.resolvedAt,
    },
  });
}

/**
 * DELETE /api/v1/comments/:cid
 *
 * 作者本人或项目 owner 可删（硬删）。
 */
export async function DELETE(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { cid } = await params;

  const row = await loadComment(cid);
  if (!row) return errorResponse("not_found");
  const isAuthor = row.authorUserId === session.userId;
  const isOwner = row.ownerId === session.userId;
  if (!isAuthor && !isOwner) return errorResponse("not_owner");

  await db.delete(comments).where(eq(comments.id, cid));
  return new Response(null, { status: 204 });
}

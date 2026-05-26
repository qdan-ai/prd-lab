import { and, asc, eq, isNull } from "drizzle-orm";
import { comments, db, projects, snapshots, users, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ sid: string }> };

/**
 * 三锚点字段互斥校验（与 DB CHECK 约束镜像，API 层提早 400）
 */
type AnchorPayload =
  | { anchor_kind: "annotation_item"; anchor_annotation_id: string }
  | { anchor_kind: "canvas_point"; anchor_frame_id: string; anchor_xy: { x: number; y: number } }
  | {
      anchor_kind: "frame_element";
      anchor_frame_id: string;
      anchor_xy: { x: number; y: number };
      anchor_selector?: string | null;
    };

function validateCreateBody(
  body: unknown,
): { ok: true; data: AnchorPayload & { content: string } } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") return { ok: false, reason: "body must be JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.content !== "string" || !b.content.trim())
    return { ok: false, reason: "content required non-empty string" };
  if (b.content.length > 5000) return { ok: false, reason: "content too long (>5000)" };

  if (b.anchor_kind === "annotation_item") {
    if (typeof b.anchor_annotation_id !== "string" || !b.anchor_annotation_id)
      return { ok: false, reason: "anchor_annotation_id required" };
    if (b.anchor_frame_id != null || b.anchor_xy != null || b.anchor_selector != null)
      return { ok: false, reason: "annotation_item must not carry frame/xy/selector" };
    return {
      ok: true,
      data: {
        anchor_kind: "annotation_item",
        anchor_annotation_id: b.anchor_annotation_id,
        content: b.content,
      },
    };
  }

  if (b.anchor_kind === "canvas_point" || b.anchor_kind === "frame_element") {
    if (typeof b.anchor_frame_id !== "string" || !b.anchor_frame_id)
      return { ok: false, reason: "anchor_frame_id required" };
    const xy = b.anchor_xy;
    if (!xy || typeof xy !== "object")
      return { ok: false, reason: "anchor_xy required" };
    const xyo = xy as Record<string, unknown>;
    if (
      typeof xyo.x !== "number" ||
      typeof xyo.y !== "number" ||
      xyo.x < 0 ||
      xyo.x > 100 ||
      xyo.y < 0 ||
      xyo.y > 100 ||
      !Number.isFinite(xyo.x) ||
      !Number.isFinite(xyo.y)
    )
      return { ok: false, reason: "anchor_xy.{x,y} must be number 0..100" };
    if (b.anchor_annotation_id != null)
      return { ok: false, reason: "canvas_point/frame_element must not carry anchor_annotation_id" };
    if (b.anchor_kind === "canvas_point") {
      if (b.anchor_selector != null)
        return { ok: false, reason: "canvas_point must not carry anchor_selector" };
      return {
        ok: true,
        data: {
          anchor_kind: "canvas_point",
          anchor_frame_id: b.anchor_frame_id,
          anchor_xy: { x: xyo.x, y: xyo.y },
          content: b.content,
        },
      };
    }
    if (b.anchor_selector !== undefined && b.anchor_selector !== null) {
      if (typeof b.anchor_selector !== "string")
        return { ok: false, reason: "anchor_selector must be string if present" };
      if (b.anchor_selector.length > 400)
        return { ok: false, reason: "anchor_selector too long (>400)" };
    }
    return {
      ok: true,
      data: {
        anchor_kind: "frame_element",
        anchor_frame_id: b.anchor_frame_id,
        anchor_xy: { x: xyo.x, y: xyo.y },
        anchor_selector: (b.anchor_selector as string | null | undefined) ?? null,
        content: b.content,
      },
    };
  }

  return { ok: false, reason: "anchor_kind must be one of annotation_item|canvas_point|frame_element" };
}

/** 读权限：owner 或 team-visible 项目。返回 {snapshot row + version_id + archived?} 或 null。 */
async function loadSnapshotForRead(sid: string, userId: string) {
  const rows = await db
    .select({
      snapshotId: snapshots.id,
      versionId: snapshots.versionId,
      archivedAt: snapshots.archivedAt,
      ownerId: projects.ownerId,
      visibility: projects.visibility,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const isOwner = row.ownerId === userId;
  const readable = isOwner || row.visibility === "team";
  return readable ? { row, isOwner } : null;
}

/**
 * GET /api/v1/snapshots/:sid/comments
 *
 * 按 snapshot_id_at_comment 过滤，按 created_at 升序。
 * 响应：{ comments: [...], snapshot_archived: boolean }
 *   - snapshot_archived = true 时 UI 显示降级提示，所有 mutation 控件不渲染
 *   - 历史快照预览（非 current）仍能看 evidence 该快照上的评论（docs/04 §预览态规则）
 */
export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const loaded = await loadSnapshotForRead(sid, session.userId);
  if (!loaded) return errorResponse("not_found");

  const rows = await db
    .select({
      id: comments.id,
      anchorKind: comments.anchorKind,
      anchorAnnotationId: comments.anchorAnnotationId,
      anchorFrameId: comments.anchorFrameId,
      anchorXy: comments.anchorXy,
      anchorSelector: comments.anchorSelector,
      content: comments.content,
      createdAt: comments.createdAt,
      resolvedAt: comments.resolvedAt,
      authorUserId: comments.authorUserId,
      authorExternalName: comments.authorExternalName,
      authorName: users.name,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorUserId, users.id))
    .where(eq(comments.snapshotIdAtComment, sid))
    .orderBy(asc(comments.createdAt));

  return Response.json({
    comments: rows.map((r) => ({
      id: r.id,
      anchor_kind: r.anchorKind,
      anchor_annotation_id: r.anchorAnnotationId,
      anchor_frame_id: r.anchorFrameId,
      anchor_xy: r.anchorXy,
      anchor_selector: r.anchorSelector,
      content: r.content,
      created_at: r.createdAt,
      resolved_at: r.resolvedAt,
      author: {
        user_id: r.authorUserId,
        name: r.authorName ?? r.authorExternalName ?? "已删除用户",
        is_external: r.authorUserId === null && r.authorExternalName !== null,
      },
    })),
    snapshot_archived: loaded.row.archivedAt !== null,
  });
}

/**
 * POST /api/v1/snapshots/:sid/comments
 *
 * 任何能 read 的用户都能评论（docs/CLAUDE §"评论权限"）。
 * archived snapshot 也允许写（docs/04 §预览态：评论挂在 snapshot_id_at_comment 上，归档不阻断）。
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const loaded = await loadSnapshotForRead(sid, session.userId);
  if (!loaded) return errorResponse("not_found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const valid = validateCreateBody(body);
  if (!valid.ok) return errorResponse("validation_error", valid.reason);
  const v = valid.data;

  const insertedRows = await db
    .insert(comments)
    .values({
      versionId: loaded.row.versionId,
      snapshotIdAtComment: sid,
      anchorKind: v.anchor_kind,
      anchorAnnotationId: v.anchor_kind === "annotation_item" ? v.anchor_annotation_id : null,
      anchorFrameId:
        v.anchor_kind === "canvas_point" || v.anchor_kind === "frame_element"
          ? v.anchor_frame_id
          : null,
      anchorXy:
        v.anchor_kind === "canvas_point" || v.anchor_kind === "frame_element" ? v.anchor_xy : null,
      anchorSelector: v.anchor_kind === "frame_element" ? v.anchor_selector ?? null : null,
      authorUserId: session.userId,
      content: v.content,
    })
    .returning();
  const inserted = insertedRows[0];
  if (!inserted) return errorResponse("validation_error", "insert failed");

  return Response.json(
    {
      comment: {
        id: inserted.id,
        anchor_kind: inserted.anchorKind,
        anchor_annotation_id: inserted.anchorAnnotationId,
        anchor_frame_id: inserted.anchorFrameId,
        anchor_xy: inserted.anchorXy,
        anchor_selector: inserted.anchorSelector,
        content: inserted.content,
        created_at: inserted.createdAt,
        resolved_at: inserted.resolvedAt,
        author: {
          user_id: session.userId,
          name: session.userName,
          is_external: false,
        },
      },
    },
    { status: 201 },
  );
}

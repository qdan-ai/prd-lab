import { and, asc, eq } from "drizzle-orm";
import { comments, db, snapshots, users } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { getShareSession } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * 三锚点字段互斥校验（与 DB CHECK 镜像）。访客侧复用，与 owner POST /api/v1/snapshots/[sid]/comments
 * 中的逻辑保持一致（S5 范围内手动复制；后续若有变更需双侧同步，或抽 shared helper）。
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
    if (!xy || typeof xy !== "object") return { ok: false, reason: "anchor_xy required" };
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
      return {
        ok: false,
        reason: "canvas_point/frame_element must not carry anchor_annotation_id",
      };
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

  return {
    ok: false,
    reason: "anchor_kind must be one of annotation_item|canvas_point|frame_element",
  };
}

/**
 * GET /share/[shareId]/api/comments?snapshotId={sid}
 *
 * S8：访客仅能看 share 绑定的 snapshot 评论。snapshotId query 必须等于 session.snapshotId。
 * 评论 author_external_name 暴露给访客（共看楼层），author_user_id 解析为 users.name。
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
      authorUserName: users.name,
      authorExternalName: comments.authorExternalName,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorUserId, users.id))
    .where(eq(comments.snapshotIdAtComment, sid))
    .orderBy(asc(comments.createdAt));

  return Response.json({
    snapshotId: sid,
    allowComment: session.allowComment,
    snapshotArchived: false,
    // author 字段格式与 owner 侧 commentsApi.list 保持一致（CommentDTO.author = {user_id, name, is_external}）
    // SDK buildCommentItem 读 c.author.name / c.author.user_id，必须用对象形态
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
        name: r.authorUserName ?? r.authorExternalName ?? "已删除用户",
        is_external: r.authorUserId === null && r.authorExternalName !== null,
      },
    })),
  });
}

/**
 * POST /share/[shareId]/api/comments
 *
 * 访客留评：author_user_id=NULL + author_external_name/email 来自 cookie。
 * 校 share.allow_comment 通过；否则 403 not_owner（语义复用：访客无权变更）。
 *
 * 评论永远挂在 current snapshot 上（snapshot_id_at_comment 取 versions.current_snapshot_id）。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { shareId } = await params;
  const session = await getShareSession(shareId);
  if (session.kind === "revoked") return errorResponse("share_revoked");
  if (session.kind === "not_found") return errorResponse("share_not_found");
  if (session.kind === "invalid") return errorResponse("unauthorized");
  if (!session.allowComment) return errorResponse("not_owner", "comment disabled by owner");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const validated = validateCreateBody(body);
  if (!validated.ok) return errorResponse("validation_error", validated.reason);

  // S8：share 已绑 snapshot，直接用 session.snapshotId；二次校验未 archived
  const snapRows = await db
    .select({ archivedAt: snapshots.archivedAt, versionId: snapshots.versionId })
    .from(snapshots)
    .where(eq(snapshots.id, session.snapshotId))
    .limit(1);
  if (!snapRows[0] || snapRows[0].archivedAt !== null) {
    return errorResponse("snapshot_archived");
  }

  const insertValues = {
    versionId: snapRows[0].versionId,
    snapshotIdAtComment: session.snapshotId,
    anchorKind: validated.data.anchor_kind,
    anchorAnnotationId:
      validated.data.anchor_kind === "annotation_item"
        ? validated.data.anchor_annotation_id
        : null,
    anchorFrameId:
      validated.data.anchor_kind === "annotation_item" ? null : validated.data.anchor_frame_id,
    anchorXy:
      validated.data.anchor_kind === "annotation_item" ? null : validated.data.anchor_xy,
    anchorSelector:
      validated.data.anchor_kind === "frame_element"
        ? validated.data.anchor_selector ?? null
        : null,
    authorUserId: null,
    authorExternalName: session.name,
    authorExternalEmail: session.email,
    content: validated.data.content.trim(),
  };

  const [row] = await db.insert(comments).values(insertValues).returning({
    id: comments.id,
    anchorKind: comments.anchorKind,
    content: comments.content,
    createdAt: comments.createdAt,
    resolvedAt: comments.resolvedAt,
    anchorAnnotationId: comments.anchorAnnotationId,
    anchorFrameId: comments.anchorFrameId,
    anchorXy: comments.anchorXy,
    anchorSelector: comments.anchorSelector,
  });
  if (!row) return errorResponse("validation_error", "insert returned no row");

  return Response.json(
    {
      comment: {
        id: row.id,
        anchor_kind: row.anchorKind,
        anchor_annotation_id: row.anchorAnnotationId,
        anchor_frame_id: row.anchorFrameId,
        anchor_xy: row.anchorXy,
        anchor_selector: row.anchorSelector,
        content: row.content,
        created_at: row.createdAt,
        resolved_at: row.resolvedAt,
        author: {
          user_id: null,
          name: session.name,
          is_external: true,
        },
      },
    },
    { status: 201 },
  );
}

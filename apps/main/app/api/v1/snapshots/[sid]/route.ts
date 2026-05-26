import { and, eq, isNull } from "drizzle-orm";
import { db, projects, snapshots, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ sid: string }> };

/**
 * PATCH /api/v1/snapshots/:sid  改 change_note 或 version_label（owner-only）
 * body: { change_note?: string (1..2000), version_label?: string | null (空/null=清除，1..64) }
 * 至少一个字段必填。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse("validation_error", "body must be JSON object");
  }
  const b = body as { change_note?: unknown; version_label?: unknown };

  const update: { changeNote?: string; versionLabel?: string | null } = {};

  if (b.change_note !== undefined) {
    if (typeof b.change_note !== "string") {
      return errorResponse("validation_error", "change_note must be string");
    }
    const v = b.change_note.trim();
    if (!v || v.length > 2000) {
      return errorResponse("validation_error", "change_note must be 1..2000 chars");
    }
    update.changeNote = v;
  }

  if (b.version_label !== undefined) {
    if (b.version_label === null) {
      update.versionLabel = null;
    } else if (typeof b.version_label !== "string") {
      return errorResponse("validation_error", "version_label must be string or null");
    } else {
      const v = b.version_label.trim();
      if (v === "") {
        update.versionLabel = null; // 空字符串等同清除
      } else if (v.length > 64) {
        return errorResponse("validation_error", "version_label max 64 chars");
      } else {
        update.versionLabel = v;
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return errorResponse("validation_error", "no editable fields");
  }

  // join 链：snapshots → versions → projects 拿 owner_id
  const rows = await db
    .select({
      snapshotId: snapshots.id,
      archivedAt: snapshots.archivedAt,
      ownerId: projects.ownerId,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  if (row.ownerId !== session.userId) return errorResponse("not_owner");
  if (row.archivedAt !== null) return errorResponse("snapshot_archived");

  try {
    await db.update(snapshots).set(update).where(eq(snapshots.id, sid));
    const [updated] = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.id, sid))
      .limit(1);
    return Response.json(updated);
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse(
        "version_label_conflict",
        "version_label already used by another active snapshot in this version",
      );
    }
    throw e;
  }
}

/**
 * DELETE /api/v1/snapshots/:sid  软删（owner-only）
 * S8：snapshot 平行化，无 current 概念；可删任意活跃 snapshot。
 */
export async function DELETE(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const rows = await db
    .select({
      archivedAt: snapshots.archivedAt,
      ownerId: projects.ownerId,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  if (row.ownerId !== session.userId) return errorResponse("not_owner");
  if (row.archivedAt !== null) return errorResponse("snapshot_archived");

  await db
    .update(snapshots)
    .set({ archivedAt: new Date(), archivedBy: session.userId })
    .where(eq(snapshots.id, sid));

  return new Response(null, { status: 204 });
}


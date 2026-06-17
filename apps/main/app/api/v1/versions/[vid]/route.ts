import { and, eq, isNull } from "drizzle-orm";
import { db, projects, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { canManageProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ vid: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

  const rows = await db
    .select({
      v: versions,
      ownerId: projects.ownerId,
      visibility: projects.visibility,
    })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(versions.id, vid),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  const canRead = row.visibility === "team" || row.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");

  return Response.json(row.v);
}

/**
 * PATCH /api/v1/versions/:vid
 * S8：仅支持 `{name}` 重命名；删除 `{snapshot_seq}` 设当前路径（current 概念废弃）。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse("validation_error", "body must be JSON object");
  }
  const b = body as Record<string, unknown>;
  if (b.name === undefined) {
    return errorResponse("validation_error", "no editable fields");
  }
  if (typeof b.name !== "string") {
    return errorResponse("validation_error", "name must be string");
  }
  const name = b.name.trim();
  if (!name || name.length > 64) {
    return errorResponse("validation_error", "invalid name");
  }

  // 管理权校验（owner 或 team 项目管理员）
  const ownerRows = await db
    .select({ ownerId: projects.ownerId, visibility: projects.visibility })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(versions.id, vid),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProject(ownerRows[0], session)) return errorResponse("not_owner");

  try {
    await db
      .update(versions)
      .set({ name })
      .where(and(eq(versions.id, vid), isNull(versions.archivedAt)));
    const [row] = await db
      .select()
      .from(versions)
      .where(and(eq(versions.id, vid), isNull(versions.archivedAt)))
      .limit(1);
    if (!row) return errorResponse("not_found");
    return Response.json(row);
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("name_conflict", "version name already exists");
    }
    throw e;
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

  const ownerRows = await db
    .select({ ownerId: projects.ownerId, visibility: projects.visibility })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(versions.id, vid),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProject(ownerRows[0], session)) return errorResponse("not_owner");

  await db
    .update(versions)
    .set({ archivedAt: new Date() })
    .where(eq(versions.id, vid));
  return new Response(null, { status: 204 });
}

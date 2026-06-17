import { and, eq, isNull, or } from "drizzle-orm";
import { db, projects } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { canManageProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ pid: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  const project = rows[0];
  if (!project) return errorResponse("not_found");

  // 可见性过滤：team 大家可见；private 仅 owner
  const canRead = project.visibility === "team" || project.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found"); // 防探测：私有项目对非 owner 假装 404

  return Response.json(project);
}

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }

  const update = parsePatch(body);
  if (!update.ok) return errorResponse("validation_error", update.message);
  if (Object.keys(update.fields).length === 0) {
    return errorResponse("validation_error", "no editable fields");
  }

  // 校验管理权（owner 恒可；管理员可管 team 项目）
  const ownerRows = await db
    .select({ ownerId: projects.ownerId, visibility: projects.visibility })
    .from(projects)
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProject(ownerRows[0], session)) return errorResponse("not_owner");
  // 可见性改动收紧为 owner-only：管理员可改 team 项目的 name，但不得改可见性。
  // 否则 admin 能把他人 team 项目改成 private，改完后自己既读不到也管不了（canManage 只放行 team），不可逆。
  if (update.fields.visibility !== undefined && ownerRows[0].ownerId !== session.userId) {
    return errorResponse("not_owner", "仅项目所有者可修改可见性");
  }

  try {
    await db
      .update(projects)
      .set(update.fields)
      .where(and(eq(projects.id, pid), isNull(projects.archivedAt)));
    const [updated] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
      .limit(1);
    if (!updated) return errorResponse("not_found");
    return Response.json(updated);
  } catch (e: unknown) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("name_conflict", "project name already exists");
    }
    throw e;
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  const ownerRows = await db
    .select({ ownerId: projects.ownerId, visibility: projects.visibility })
    .from(projects)
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProject(ownerRows[0], session)) return errorResponse("not_owner");

  await db
    .update(projects)
    .set({ archivedAt: new Date() })
    .where(eq(projects.id, pid));
  return new Response(null, { status: 204 });
}

// ---- helpers ----

function parsePatch(body: unknown):
  | { ok: true; fields: { name?: string; visibility?: "private" | "team" } }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  const fields: { name?: string; visibility?: "private" | "team" } = {};

  if (b.name !== undefined) {
    if (typeof b.name !== "string") return { ok: false, message: "name must be string" };
    const trimmed = b.name.trim();
    if (!trimmed || trimmed.length > 128) return { ok: false, message: "invalid name" };
    fields.name = trimmed;
  }

  if (b.visibility !== undefined) {
    if (b.visibility !== "private" && b.visibility !== "team") {
      return { ok: false, message: "visibility must be 'private' or 'team'" };
    }
    fields.visibility = b.visibility;
  }

  return { ok: true, fields };
}


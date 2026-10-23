import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { projectReadableBy } from "@prd-lab/core";
import { and, eq, isNull } from "drizzle-orm";
import { db, projects } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { canEditProject, canChangeProjectVisibility } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ pid: string }> };

export async function GET(_: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, pid), projectReadableBy(session.userId)))
    .limit(1);
  const project = rows[0];
  if (!project) return errorResponse("not_found");

  return Response.json(project);
}

export async function PATCH(request: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
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

  try {
    return await db.transaction(async (tx) => {
      // Serialize visibility decisions with concurrent PATCH/DELETE; no stale preflight authorization.
      const [project] = await tx.select().from(projects)
        .where(and(eq(projects.id, pid), isNull(projects.archivedAt))).for("update");
      if (!project) return errorResponse("not_found");
      if (update.fields.name !== undefined && !canEditProject(project, session)) {
        return errorResponse("not_owner");
      }
      if (update.fields.visibility !== undefined &&
          !canChangeProjectVisibility(project, session, update.fields.visibility)) {
        return errorResponse("not_owner");
      }
      await tx.update(projects).set(update.fields)
        .where(and(eq(projects.id, pid), isNull(projects.archivedAt)));
      const [updated] = await tx.select().from(projects).where(eq(projects.id, pid));
      return Response.json(updated);
    });
  } catch (e: unknown) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("name_conflict", "project name already exists");
    }
    throw e;
  }
}

export async function DELETE(_: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  const ownerRows = await db
    .select({ ownerId: projects.ownerId, visibility: projects.visibility })
    .from(projects)
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canEditProject(ownerRows[0], session)) return errorResponse("not_owner");

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


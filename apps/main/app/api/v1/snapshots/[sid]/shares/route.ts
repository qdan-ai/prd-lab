import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  generateShareId,
  hashPassword,
  shareLinks,
  projects,
  snapshots,
  versions,
} from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { canManageProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ sid: string }> };

/**
 * GET /api/v1/snapshots/:sid/shares
 *
 * S8：share 绑 snapshot 级。owner-only。返回当前 active share link 或 null。
 */
export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const ownerRows = await db
    .select({
      ownerId: projects.ownerId,
      visibility: projects.visibility,
      archivedAt: snapshots.archivedAt,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProject(ownerRows[0], session)) return errorResponse("not_owner");
  if (ownerRows[0].archivedAt !== null) return errorResponse("snapshot_archived");

  const rows = await db
    .select({
      id: shareLinks.id,
      createdAt: shareLinks.createdAt,
      passwordVersion: shareLinks.passwordVersion,
      passwordHash: shareLinks.passwordHash,
    })
    .from(shareLinks)
    .where(and(eq(shareLinks.snapshotId, sid), isNull(shareLinks.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return Response.json({ share: null });

  return Response.json({
    share: {
      shareId: row.id,
      createdAt: row.createdAt,
      passwordVersion: row.passwordVersion,
      hasPassword: row.passwordHash !== null,
    },
  });
}

/**
 * POST /api/v1/snapshots/:sid/shares
 *
 * S8：share 绑 snapshot 级。已有 active link → 409 share_already_exists。
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return errorResponse("validation_error", parsed.message);

  const ownerRows = await db
    .select({
      ownerId: projects.ownerId,
      visibility: projects.visibility,
      archivedAt: snapshots.archivedAt,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProject(ownerRows[0], session)) return errorResponse("not_owner");
  if (ownerRows[0].archivedAt !== null) return errorResponse("snapshot_archived");

  const id = generateShareId();
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : null;

  try {
    await db
      .insert(shareLinks)
      .values({
        id,
        snapshotId: sid,
        passwordHash,
        passwordVersion: 1,
        createdBy: session.userId,
      });
    const [row] = await db
      .select({
        id: shareLinks.id,
        createdAt: shareLinks.createdAt,
        passwordVersion: shareLinks.passwordVersion,
        passwordHash: shareLinks.passwordHash,
      })
      .from(shareLinks)
      .where(eq(shareLinks.id, id))
      .limit(1);
    if (!row) return errorResponse("validation_error", "insert returned no row");
    return Response.json(
      {
        share: {
          shareId: row.id,
          createdAt: row.createdAt,
          passwordVersion: row.passwordVersion,
          hasPassword: row.passwordHash !== null,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("share_already_exists");
    }
    throw e;
  }
}

function parseCreateBody(body: unknown):
  | { ok: true; password?: string }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  // 密码可选：缺省 / null / 空串 三者一律视为无密码（不报 400）。
  // 仅当传入非空字符串时才设密码，并走 6..200 长度校验。
  if (b.password === undefined || b.password === null || b.password === "") {
    return { ok: true };
  }
  if (typeof b.password !== "string") {
    return { ok: false, message: "password must be string" };
  }
  if (b.password.length < 6 || b.password.length > 200) {
    return { ok: false, message: "password length must be 6..200" };
  }
  return { ok: true, password: b.password };
}

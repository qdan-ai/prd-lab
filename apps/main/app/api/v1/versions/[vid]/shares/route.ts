import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { and, eq, isNull } from "drizzle-orm";
import { db, generateShareId, hashPassword, notTeamVersion, shareLinks, projects, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { canManageProjectShares } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ vid: string }> };

/**
 * GET /api/v1/versions/:vid/shares
 *
 * S19：share 绑方案（version）级。owner-only。返回当前 active share link 或 null。
 * 不要求方案有活跃 snapshot（空方案分享无害，访客见空态）。
 */
export async function GET(_: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

  const ownerRows = await db
    .select({
      ownerId: projects.ownerId,
      visibility: projects.visibility,
    })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(eq(versions.id, vid), isNull(versions.archivedAt), isNull(projects.archivedAt), notTeamVersion(versions.id)),
    )
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProjectShares(ownerRows[0], session)) return errorResponse("not_owner");

  const rows = await db
    .select({
      id: shareLinks.id,
      createdAt: shareLinks.createdAt,
      passwordVersion: shareLinks.passwordVersion,
      passwordHash: shareLinks.passwordHash,
    })
    .from(shareLinks)
    .where(and(eq(shareLinks.versionId, vid), isNull(shareLinks.revokedAt)))
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
 * POST /api/v1/versions/:vid/shares
 *
 * S19：share 绑方案（version）级。已有 active link → 409 share_already_exists。
 */
export async function POST(request: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

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
    })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(eq(versions.id, vid), isNull(versions.archivedAt), isNull(projects.archivedAt), notTeamVersion(versions.id)),
    )
    .limit(1);
  if (!ownerRows[0]) return errorResponse("not_found");
  if (!canManageProjectShares(ownerRows[0], session)) return errorResponse("not_owner");

  const id = generateShareId();
  const passwordHash = parsed.password ? await hashPassword(parsed.password) : null;

  try {
    await db.insert(shareLinks).values({
      id,
      versionId: vid,
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

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  hashPassword,
  projects,
  shareLinks,
  snapshots,
  versions,
} from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * PATCH /api/v1/shares/:shareId
 *
 * owner-only。仅支持 body { password } 重置密码（hash + password_version++ → 旧 cookie pv 失效）。
 * 已 revoked → 410 share_revoked。
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { shareId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const parsed = parsePatchBody(body);
  if (!parsed.ok) return errorResponse("validation_error", parsed.message);

  const lookup = await loadShareForOwner(shareId, session.userId);
  if (lookup.kind === "error") return errorResponse(lookup.code);

  const setObj: Record<string, unknown> = {
    passwordHash: await hashPassword(parsed.password),
    passwordVersion: sql`${shareLinks.passwordVersion} + 1`,
  };

  await db
    .update(shareLinks)
    .set(setObj)
    .where(and(eq(shareLinks.id, shareId), isNull(shareLinks.revokedAt)));
  const [row] = await db
    .select({
      id: shareLinks.id,
      createdAt: shareLinks.createdAt,
      passwordVersion: shareLinks.passwordVersion,
    })
    .from(shareLinks)
    .where(and(eq(shareLinks.id, shareId), isNull(shareLinks.revokedAt)))
    .limit(1);
  if (!row) return errorResponse("share_not_found");

  return Response.json({
    share: {
      shareId: row.id,
      createdAt: row.createdAt,
      passwordVersion: row.passwordVersion,
    },
  });
}

/**
 * DELETE /api/v1/shares/:shareId
 *
 * owner-only 软删（写 revoked_at）。撤销后 active 索引释放，可立即新建。
 */
export async function DELETE(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { shareId } = await params;

  const lookup = await loadShareForOwner(shareId, session.userId);
  if (lookup.kind === "error") return errorResponse(lookup.code);

  await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, shareId), isNull(shareLinks.revokedAt)));
  return new Response(null, { status: 204 });
}

// ---- helpers ----

type LoadResult =
  | { kind: "ok"; snapshotId: string }
  | { kind: "error"; code: "share_not_found" | "share_revoked" | "not_owner" };

async function loadShareForOwner(shareId: string, userId: string): Promise<LoadResult> {
  const rows = await db
    .select({
      snapshotId: shareLinks.snapshotId,
      revokedAt: shareLinks.revokedAt,
      ownerId: projects.ownerId,
    })
    .from(shareLinks)
    .innerJoin(snapshots, eq(shareLinks.snapshotId, snapshots.id))
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  const row = rows[0];
  if (!row) return { kind: "error", code: "share_not_found" };
  if (row.ownerId !== userId) return { kind: "error", code: "not_owner" };
  if (row.revokedAt !== null) return { kind: "error", code: "share_revoked" };
  return { kind: "ok", snapshotId: row.snapshotId };
}

function parsePatchBody(body: unknown):
  | { ok: true; password: string }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.password !== "string") {
    return { ok: false, message: "password required string" };
  }
  if (b.password.length < 6 || b.password.length > 200) {
    return { ok: false, message: "password length must be 6..200" };
  }
  return { ok: true, password: b.password };
}

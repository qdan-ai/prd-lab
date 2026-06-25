import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  hashPassword,
  projects,
  shareLinks,
  snapshots,
  versions,
} from "@prd-lab/core";
import { getSession, type Session } from "@/lib/api/auth-guard";
import { canManageProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ shareId: string }> };

/**
 * PATCH /api/v1/shares/:shareId
 *
 * owner-only。密码管理三合一，请求体为互斥 tagged union：
 *   - { action: "set", password }   → 设/改密码：校验 6..200，写新 hash，password_version + 1（旧 cookie pv 失效）。
 *   - { action: "remove" }          → 去密码：password_hash = null，pv 不变（无密码分支不读 cookie，正在看的访客不受影响）。
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

  const lookup = await loadShareForOwner(shareId, session);
  if (lookup.kind === "error") return errorResponse(lookup.code);

  const setObj: Record<string, unknown> =
    parsed.action === "set"
      ? {
          passwordHash: await hashPassword(parsed.password),
          passwordVersion: sql`${shareLinks.passwordVersion} + 1`,
        }
      : {
          // 去密码：pv 不变（见状态迁移矩阵）。
          passwordHash: null,
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
      passwordHash: shareLinks.passwordHash,
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
      hasPassword: row.passwordHash !== null,
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

  const lookup = await loadShareForOwner(shareId, session);
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

async function loadShareForOwner(
  shareId: string,
  session: Pick<Session, "userId" | "isAdmin">,
): Promise<LoadResult> {
  const rows = await db
    .select({
      snapshotId: shareLinks.snapshotId,
      revokedAt: shareLinks.revokedAt,
      ownerId: projects.ownerId,
      visibility: projects.visibility,
    })
    .from(shareLinks)
    .innerJoin(snapshots, eq(shareLinks.snapshotId, snapshots.id))
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  const row = rows[0];
  if (!row) return { kind: "error", code: "share_not_found" };
  if (!canManageProject(row, session)) return { kind: "error", code: "not_owner" };
  if (row.revokedAt !== null) return { kind: "error", code: "share_revoked" };
  return { kind: "ok", snapshotId: row.snapshotId };
}

function parsePatchBody(body: unknown):
  | { ok: true; action: "set"; password: string }
  | { ok: true; action: "remove" }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (b.action === "set") {
    if (typeof b.password !== "string") {
      return { ok: false, message: "password required string for action=set" };
    }
    if (b.password.length < 6 || b.password.length > 200) {
      return { ok: false, message: "password length must be 6..200" };
    }
    return { ok: true, action: "set", password: b.password };
  }
  if (b.action === "remove") {
    return { ok: true, action: "remove" };
  }
  return { ok: false, message: 'action must be "set" or "remove"' };
}

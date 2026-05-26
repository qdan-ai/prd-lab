import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, projects, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION, PG_LOCK_NOT_AVAILABLE } from "@/lib/api/pg-errors";
import { insertReturning } from "@/lib/db/insert-returning";

type Ctx = { params: Promise<{ pid: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  // 可见性过滤
  const projRows = await db
    .select({ visibility: projects.visibility, ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  if (!projRows[0]) return errorResponse("not_found");
  const canRead = projRows[0].visibility === "team" || projRows[0].ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");

  const list = await db
    .select()
    .from(versions)
    .where(and(eq(versions.projectId, pid), isNull(versions.archivedAt)))
    .orderBy(asc(versions.seqNo));
  return Response.json(list);
}

export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return errorResponse("validation_error", parsed.message);

  // 仅 owner 可建 version
  const projRows = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  if (!projRows[0]) return errorResponse("not_found");
  if (projRows[0].ownerId !== session.userId) return errorResponse("not_owner");

  try {
    const result = await db.transaction(async (tx) => {
      // FOR UPDATE 锁 projects 行，防止并发抢 seq_no
      // （即便不直接改 projects 也锁住，作为该项目所有 versions 写入的串行点）
      await tx.execute(
        sql`SELECT 1 FROM projects WHERE id = ${pid} FOR UPDATE`,
      );

      // 拿当前最大 seq_no（含归档）
      const maxRow = await tx
        .select({ maxSeq: sql<number | null>`MAX(${versions.seqNo})` })
        .from(versions)
        .where(eq(versions.projectId, pid));
      const nextSeq = (maxRow[0]?.maxSeq ?? 0) + 1;

      const version = await insertReturning(tx, versions, {
        projectId: pid,
        name: parsed.name,
        seqNo: nextSeq,
        createdBy: session.userId,
      });
      return version;
    });
    return Response.json(result, { status: 201 });
  } catch (e: unknown) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("name_conflict", "version name already exists");
    }
    if (isPgError(e, PG_LOCK_NOT_AVAILABLE)) {
      return errorResponse("version_locked");
    }
    throw e;
  }
}

// ---- helpers ----

function parseCreateBody(body: unknown):
  | { ok: true; name: string }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 64) return { ok: false, message: "invalid name" };
  return { ok: true, name };
}


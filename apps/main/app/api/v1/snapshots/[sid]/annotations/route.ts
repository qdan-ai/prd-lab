import { and, eq, isNull, sql } from "drizzle-orm";
import { annotationLinks, db, projects, snapshots, versions } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

type Ctx = { params: Promise<{ sid: string }> };

/**
 * 标注 schema（与 canvas-v2-demo annotations.json 兼容）：
 *   {
 *     id: string,        // 唯一 id（"a1" / uuid 均可）
 *     frameId: string,   // 画板 frame 标识（"f1" / "tab1-row" 等）
 *     x: number,         // 0..100 百分比
 *     y: number,         // 0..100 百分比
 *     title?: string,
 *     module?: string,   // 右抽屉分组依据
 *     content?: string,  // markdown
 *   }
 */
function validateAnnotations(input: unknown): { ok: true; data: unknown[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) return { ok: false, reason: "annotations must be array" };
  if (input.length > 1000) return { ok: false, reason: "annotations too many (>1000)" };
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!a || typeof a !== "object") return { ok: false, reason: `annotations[${i}] must be object` };
    const obj = a as Record<string, unknown>;
    if (typeof obj.id !== "string" || !obj.id) return { ok: false, reason: `annotations[${i}].id required string` };
    if (typeof obj.frameId !== "string" || !obj.frameId)
      return { ok: false, reason: `annotations[${i}].frameId required string` };
    if (typeof obj.x !== "number" || obj.x < 0 || obj.x > 100 || !Number.isFinite(obj.x))
      return { ok: false, reason: `annotations[${i}].x must be number 0..100` };
    if (typeof obj.y !== "number" || obj.y < 0 || obj.y > 100 || !Number.isFinite(obj.y))
      return { ok: false, reason: `annotations[${i}].y must be number 0..100` };
    for (const k of ["title", "module", "content"]) {
      if (obj[k] !== undefined && typeof obj[k] !== "string")
        return { ok: false, reason: `annotations[${i}].${k} must be string if present` };
    }
  }
  return { ok: true, data: input };
}

/** 读权限：owner 或 team-visible 项目。返回 { snapshot row, isOwner } 或 null。 */
async function loadSnapshotForRead(sid: string, userId: string) {
  const rows = await db
    .select({
      snapshotId: snapshots.id,
      archivedAt: snapshots.archivedAt,
      ownerId: projects.ownerId,
      visibility: projects.visibility,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const isOwner = row.ownerId === userId;
  const readable = isOwner || row.visibility === "team";
  return readable ? { row, isOwner } : null;
}

/**
 * GET /api/v1/snapshots/:sid/annotations
 * 返回当前标注集合 + 乐观锁 revision + 来源
 * - annotation_links 不存在 → {annotations: [], revision: 0, source: 'platform'}
 */
export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  const loaded = await loadSnapshotForRead(sid, session.userId);
  if (!loaded) return errorResponse("not_found");

  const links = await db
    .select({
      dataJsonb: annotationLinks.dataJsonb,
      revision: annotationLinks.revision,
      source: annotationLinks.source,
    })
    .from(annotationLinks)
    .where(eq(annotationLinks.snapshotId, sid))
    .limit(1);
  const link = links[0];
  if (!link) {
    return Response.json({ annotations: [], revision: 0, source: "platform" });
  }
  const data = (link.dataJsonb as { annotations?: unknown[] }) || {};
  return Response.json({
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
    revision: link.revision,
    source: link.source,
  });
}

/**
 * PATCH /api/v1/snapshots/:sid/annotations
 * body: { annotations: AnnotationItem[], expected_revision: number }
 *
 * 乐观锁：事务内 SELECT FOR UPDATE → 校验 revision === expected_revision → UPDATE data_jsonb + revision+1
 * - 不存在 annotation_links 时（embedded annotations 已经在 S2 上传时写入；platform-only 场景留空）：
 *   expected_revision === 0 → INSERT 新行（source='platform'，revision=1）
 *   expected_revision !== 0 → revision_conflict
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
  const { annotations: rawAnnotations, expected_revision: rawExpected } = body as {
    annotations?: unknown;
    expected_revision?: unknown;
  };
  if (typeof rawExpected !== "number" || !Number.isInteger(rawExpected) || rawExpected < 0) {
    return errorResponse("validation_error", "expected_revision required non-negative integer");
  }
  const valid = validateAnnotations(rawAnnotations);
  if (!valid.ok) return errorResponse("validation_error", valid.reason);
  const expectedRevision = rawExpected;
  const annotationsArray = valid.data;

  // owner 校验（用 join 链，避免事务外再查一遍）
  const ownerRows = await db
    .select({
      archivedAt: snapshots.archivedAt,
      ownerId: projects.ownerId,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(snapshots.id, sid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const owner = ownerRows[0];
  if (!owner) return errorResponse("not_found");
  if (owner.ownerId !== session.userId) return errorResponse("not_owner");
  if (owner.archivedAt !== null) return errorResponse("snapshot_archived");

  // 事务内：lock annotation_links 行（若存在），校验 revision，UPDATE 或 INSERT
  const result = await db.transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT id, revision FROM annotation_links WHERE snapshot_id = ${sid} FOR UPDATE`,
    );
    // drizzle postgres-js adapter: tx.execute 返回数组直接索引
    const existing = (rows as unknown as Array<{ id: string; revision: number | string }>)[0];

    if (!existing) {
      if (expectedRevision !== 0) {
        return { ok: false as const, code: "revision_conflict" as const };
      }
      await tx.insert(annotationLinks).values({
        snapshotId: sid,
        source: "platform",
        dataJsonb: { annotations: annotationsArray },
        revision: 1,
      });
      return { ok: true as const, revision: 1 };
    }
    // PG integer 经 node-postgres 默认返回 number，但 raw sql 路径下保守归一化
    const currentRevision = Number(existing.revision);
    if (currentRevision !== expectedRevision) {
      return { ok: false as const, code: "revision_conflict" as const };
    }
    const newRevision = currentRevision + 1;
    await tx
      .update(annotationLinks)
      .set({
        dataJsonb: { annotations: annotationsArray },
        revision: newRevision,
        updatedAt: new Date(),
      })
      .where(eq(annotationLinks.id, existing.id));
    return { ok: true as const, revision: newRevision };
  });

  if (!result.ok) return errorResponse(result.code);
  return Response.json({ revision: result.revision, count: annotationsArray.length });
}

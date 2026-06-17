import { and, desc, eq, inArray, isNull, max, or, sql as drizzleSql } from "drizzle-orm";
import { db, projects, snapshots, versions, users } from "@prd-lab/core";
import { getSession, type Session } from "@/lib/api/auth-guard";
import { canManageProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";
import { insertReturning } from "@/lib/db/insert-returning";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");

  const url = new URL(request.url);
  if (url.searchParams.get("view") === "switcher") {
    return Response.json(await getSwitcherView(session));
  }
  return Response.json(await getProjectList(session.userId));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return errorResponse("validation_error", parsed.message);

  try {
    // S17：项目与方案解耦——只建 project，不再自动建第一个 version。
    // 项目可处于「0 方案」状态，由 /projects/[pid] 落地页渲染空状态引导新建方案。
    const project = await insertReturning(db, projects, {
      name: parsed.name,
      ownerId: session.userId,
      visibility: parsed.visibility,
    });

    return Response.json({ project }, { status: 201 });
  } catch (e: unknown) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("name_conflict", "project name already exists");
    }
    // owner_id FK 违例 = session.userId 已不在 users 表（dev truncate 或外部删）
    // 不等 60s lazy verify，直接 401，前端 toast → 用户重登
    if (isPgError(e, PG_FOREIGN_KEY_VIOLATION)) {
      return errorResponse("unauthorized", "登入态失效，请重新登入");
    }
    // dev 暴露 stack 便于排查；prod 走 throw 让 Next.js 默认 500 handler
    if (process.env.NODE_ENV !== "production") {
      console.error("[POST /projects] internal error", e);
      const err = e as { message?: string; stack?: string; code?: string };
      return Response.json(
        {
          error_code: "internal_error",
          message: err.message ?? "unknown",
          stack: err.stack?.split("\n").slice(0, 6).join("\n"),
          pgCode: err.code,
        },
        { status: 500 },
      );
    }
    throw e;
  }
}

// ---- helpers ----

function parseCreateBody(body: unknown):
  | { ok: true; name: string; visibility: "private" | "team" }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 128) return { ok: false, message: "invalid name" };

  const visibility = b.visibility === "team" ? "team" : "private";

  return { ok: true, name, visibility };
}

async function getProjectList(userId: string) {
  return db
    .select()
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        or(eq(projects.visibility, "team"), eq(projects.ownerId, userId)),
      ),
    )
    .orderBy(desc(projects.createdAt));
}

/**
 * docs/09 关键路由：GET /api/v1/projects?view=switcher
 * 返回 [{ id, name, visibility, ownedByMe, versions: [...] }]
 * S1 因无 snapshot，latest_snapshot / current_snapshot_seq / active_count 暂为 null/0
 */
async function getSwitcherView(session: Pick<Session, "userId" | "isAdmin">) {
  const userId = session.userId;
  const visibleProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      visibility: projects.visibility,
      ownerId: projects.ownerId,
    })
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        or(eq(projects.visibility, "team"), eq(projects.ownerId, userId)),
      ),
    )
    .orderBy(projects.name);

  if (visibleProjects.length === 0) return [];

  const projectIds = visibleProjects.map((p) => p.id);
  const allVersions = await db
    .select({
      id: versions.id,
      projectId: versions.projectId,
      name: versions.name,
      seqNo: versions.seqNo,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(and(isNull(versions.archivedAt), inArray(versions.projectId, projectIds)))
    .orderBy(versions.seqNo);

  const versionsByProject = new Map<string, typeof allVersions>();
  for (const v of allVersions) {
    const arr = versionsByProject.get(v.projectId) ?? [];
    arr.push(v);
    versionsByProject.set(v.projectId, arr);
  }

  // S8：snapshot 平行化，无 currentSnapshotSeq；改返 latestSnapshotSeq（最大活跃 seq）
  const versionIds = allVersions.map((v) => v.id);
  type SnapshotAgg = {
    activeCount: Map<string, number>;
    latestSeq: Map<string, number>;
    latest: Map<
      string,
      {
        seqNo: number;
        versionLabel: string | null;
        uploaderName: string;
        createdAt: Date;
        changeNote: string;
      }
    >;
  };
  const agg: SnapshotAgg = {
    activeCount: new Map(),
    latestSeq: new Map(),
    latest: new Map(),
  };
  if (versionIds.length > 0) {
    const counts = await db
      .select({
        versionId: snapshots.versionId,
        activeCount: drizzleSql<number>`COUNT(*)`,
        latestSeq: max(snapshots.seqNo),
      })
      .from(snapshots)
      .where(and(inArray(snapshots.versionId, versionIds), isNull(snapshots.archivedAt)))
      .groupBy(snapshots.versionId);
    for (const c of counts) {
      agg.activeCount.set(c.versionId, c.activeCount);
      if (c.latestSeq != null) agg.latestSeq.set(c.versionId, c.latestSeq);
    }

    // latestSnapshot 元数据
    const latestPairs = counts.flatMap((c) =>
      c.latestSeq != null ? [{ versionId: c.versionId, seqNo: c.latestSeq }] : [],
    );
    if (latestPairs.length > 0) {
      const latestRows = await db
        .select({
          versionId: snapshots.versionId,
          seqNo: snapshots.seqNo,
          versionLabel: snapshots.versionLabel,
          createdAt: snapshots.createdAt,
          changeNote: snapshots.changeNote,
          uploaderName: users.name,
        })
        .from(snapshots)
        .innerJoin(users, eq(snapshots.uploaderId, users.id))
        .where(
          and(
            isNull(snapshots.archivedAt),
            or(
              ...latestPairs.map((p) =>
                and(eq(snapshots.versionId, p.versionId), eq(snapshots.seqNo, p.seqNo)),
              ),
            ),
          ),
        );
      for (const r of latestRows) {
        agg.latest.set(r.versionId, {
          seqNo: r.seqNo,
          versionLabel: r.versionLabel,
          uploaderName: r.uploaderName,
          createdAt: r.createdAt,
          changeNote: r.changeNote,
        });
      }
    }
  }

  return visibleProjects.map((p) => ({
    id: p.id,
    name: p.name,
    visibility: p.visibility,
    ownedByMe: p.ownerId === userId,
    canManage: canManageProject(p, session),
    versions: (versionsByProject.get(p.id) ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      seqNo: v.seqNo,
      activeCount: agg.activeCount.get(v.id) ?? 0,
      latestSnapshotSeq: agg.latestSeq.get(v.id) ?? null,
      latestSnapshot: agg.latest.get(v.id) ?? null,
    })),
  }));
}

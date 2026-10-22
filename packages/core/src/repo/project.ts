import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { projects, repoState, repoVersions, shareLinks, versions } from "../db/schema";

/** 仓库服务层的业务错误；路由层按 code 映射成 HTTP 错误响应。 */
export class RepoError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "not_repo"
      | "validation_error"
      | "blobs_missing"
      | "unsupported_format"
      | "discussions_not_allowed"
      | "team_managed",
    message?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

/** 系统方案的名字：仓库项目里唯一的方案，界面上不显示。 */
export const REPO_SYSTEM_VERSION_NAME = "G-canvas 仓库";

export type RepoProject = {
  id: string;
  name: string;
  ownerId: string;
  visibility: "private" | "team";
  /** 系统方案 id：快照、文件、分享链接挂在它下面 */
  versionId: string;
};

/**
 * 一个事务内建仓库项目：项目（kind=repo）+ 系统方案 + repo_state。
 * 同名活跃项目撞唯一索引时抛 mysql2 的 ER_DUP_ENTRY，由调用方映射成 name_conflict。
 */
export async function createRepoProject(input: {
  name: string;
  ownerId: string;
  visibility: "private" | "team";
}): Promise<RepoProject> {
  const projectId = randomUUID();
  const versionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      name: input.name,
      ownerId: input.ownerId,
      visibility: input.visibility,
      kind: "repo",
    });
    await tx.insert(versions).values({
      id: versionId,
      projectId,
      name: REPO_SYSTEM_VERSION_NAME,
      seqNo: 1,
      createdBy: input.ownerId,
    });
    await tx.insert(repoState).values({ projectId, versionId });
  });
  return { id: projectId, name: input.name, ownerId: input.ownerId, visibility: input.visibility, versionId };
}

/**
 * 读取未归档项目的仓库视图；不存在 / 已归档返回 null。普通项目 kind='upload'、versionId=null。
 * 调用方先按 ownerId / visibility 判权限，再看 kind（不让无权的人从「不是仓库」里得知项目存在）。
 */
export async function findProjectForRepo(projectId: string) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      ownerId: projects.ownerId,
      visibility: projects.visibility,
      kind: projects.kind,
      versionId: repoState.versionId,
    })
    .from(projects)
    .leftJoin(repoState, eq(repoState.projectId, projects.id))
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** 收窄成仓库项目：普通项目 → not_repo。 */
export function asRepoProject(row: NonNullable<Awaited<ReturnType<typeof findProjectForRepo>>>): RepoProject {
  if (row.kind !== "repo" || !row.versionId) throw new RepoError("not_repo", "project is not a repo project");
  return { id: row.id, name: row.name, ownerId: row.ownerId, visibility: row.visibility, versionId: row.versionId };
}

/** 读取未归档的仓库项目；不存在 / 已归档 → not_found；普通项目 → not_repo（不判权限，供预览站等已凭令牌授权的路径用）。 */
export async function loadRepoProject(projectId: string): Promise<RepoProject> {
  const row = await findProjectForRepo(projectId);
  if (!row) throw new RepoError("not_found");
  return asRepoProject(row);
}

/** 系统方案 → 仓库项目 id；不是任何仓库的系统方案时返回 null。旧上传接口与分享页据此分流。 */
export async function repoProjectIdOfVersion(versionId: string): Promise<string | null> {
  const rows = await db
    .select({ projectId: repoState.projectId })
    .from(repoState)
    .where(eq(repoState.versionId, versionId))
    .limit(1);
  return rows[0]?.projectId ?? null;
}

/** 列出一批仓库项目（调用方先按权限筛好 owner / visibility 条件）。 */
export async function listRepoProjects(filter: { projectIds?: string[] } = {}) {
  const where = [isNull(projects.archivedAt), eq(projects.kind, "repo")];
  if (filter.projectIds) {
    if (filter.projectIds.length === 0) return [];
    where.push(inArray(projects.id, filter.projectIds));
  }
  return db
    .select({
      id: projects.id,
      name: projects.name,
      ownerId: projects.ownerId,
      visibility: projects.visibility,
      versionId: repoState.versionId,
      lastPushedAt: repoState.lastPushedAt,
      shareId: shareLinks.id,
    })
    .from(projects)
    .innerJoin(repoState, eq(repoState.projectId, projects.id))
    .leftJoin(
      shareLinks,
      and(eq(shareLinks.versionId, repoState.versionId), isNull(shareLinks.revokedAt)),
    )
    .where(and(...where))
    .orderBy(desc(projects.createdAt));
}

/** 仓库项目当前的活跃分享链接（挂在系统方案上，一仓库最多一条）。 */
export async function getRepoShare(versionId: string) {
  const rows = await db
    .select({
      id: shareLinks.id,
      passwordHash: shareLinks.passwordHash,
      passwordVersion: shareLinks.passwordVersion,
      createdAt: shareLinks.createdAt,
    })
    .from(shareLinks)
    .where(and(eq(shareLinks.versionId, versionId), isNull(shareLinks.revokedAt)))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        shareId: row.id,
        hasPassword: row.passwordHash !== null,
        /** 改密码即 +1；本机记下的密码据此判断是否过期 */
        passwordVersion: row.passwordVersion,
        createdAt: row.createdAt,
      }
    : null;
}

/**
 * 一批仓库项目的列表摘要：访客能看到的版本数（未撤回的版本 / 基线，不含草稿与起点）与最近推送时间。
 * 不是仓库的 id 不出现在结果里。
 */
export async function repoProjectSummaries(
  projectIds: string[],
): Promise<Map<string, { versionCount: number; lastPushedAt: Date | null }>> {
  const out = new Map<string, { versionCount: number; lastPushedAt: Date | null }>();
  if (projectIds.length === 0) return out;
  const [states, counts] = await Promise.all([
    db
      .select({ projectId: repoState.projectId, lastPushedAt: repoState.lastPushedAt })
      .from(repoState)
      .where(inArray(repoState.projectId, projectIds)),
    db
      .select({ projectId: repoVersions.projectId, n: count(repoVersions.id) })
      .from(repoVersions)
      .where(
        and(
          inArray(repoVersions.projectId, projectIds),
          inArray(repoVersions.kind, ["version", "baseline"]),
          isNull(repoVersions.withdrawnAt),
        ),
      )
      .groupBy(repoVersions.projectId),
  ]);
  for (const s of states) out.set(s.projectId, { versionCount: 0, lastPushedAt: s.lastPushedAt });
  for (const c of counts) {
    const row = out.get(c.projectId);
    if (row) row.versionCount = Number(c.n);
  }
  return out;
}

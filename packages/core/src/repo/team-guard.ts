import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { projectMembers, projects, repoState, snapshots, versions } from "../db/schema";

/**
 * 团队内容的读者范围与成员角色。
 *
 * 团队内容 = 团队方案（repo_state.team_version_id 指向的 versions 行）下的全部快照，以及标了
 * `audience = 'team'` 的快照。它们只经团队接口读；访客链接、分享页、预览站和一切旧入口
 * 只能看到访客级内容（`audience = 'guest'` 且不在团队方案下），与调用者是谁无关——
 * 访客、非成员、网站管理员、已移除成员、成员本人走旧入口，结果都是「不存在」。
 */

export type ReadAudience = "guest" | "team";

/** 读快照 / 文件的可选参数。默认 `guest`；团队接口显式传 `audience: "team"`。 */
export type AudienceOpts = { audience?: ReadAudience };

export type TeamRole = "lead" | "admin" | "member";

const ROLE_RANK: Record<TeamRole, number> = { member: 1, admin: 2, lead: 3 };

/** `role` 是否达到 `min`（角色从高到低 lead > admin > member）。 */
export function roleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** 条件：该方案不是任何仓库的团队方案。`versionIdColumn` 是外层查询里的 versions.id 或 snapshots.version_id。 */
export function notTeamVersion(versionIdColumn: SQL | { getSQL(): SQL } = versions.id): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${repoState} WHERE ${repoState.teamVersionId} = ${versionIdColumn})`;
}

/**
 * 条件：外层查询里的 `snapshots` 行属于指定读者范围。
 * guest：audience 为 guest 且所属方案不是团队方案（两道判断，任一道失守另一道仍拦得住）；
 * team：audience 为 team。
 */
export function snapshotInAudience(audience: ReadAudience = "guest"): SQL {
  if (audience === "team") return eq(snapshots.audience, "team");
  return and(eq(snapshots.audience, "guest"), notTeamVersion(snapshots.versionId))!;
}

/** 该快照是否团队内容（不存在的快照返回 false）。路由层补充判断用。 */
export async function isTeamSnapshot(snapshotId: string): Promise<boolean> {
  const rows = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(and(eq(snapshots.id, snapshotId), sql`NOT (${snapshotInAudience("guest")})`))
    .limit(1);
  return rows.length > 0;
}

/** 该方案是否某个仓库的团队方案。 */
export async function isTeamVersion(versionId: string): Promise<boolean> {
  const rows = await db
    .select({ projectId: repoState.projectId })
    .from(repoState)
    .where(eq(repoState.teamVersionId, versionId))
    .limit(1);
  return rows.length > 0;
}

export type TeamAccess = {
  /** 项目已开启团队协作（有团队方案） */
  enabled: boolean;
  /** 当前用户在项目里的角色；主人恒为 lead；非成员与已移除成员为 null */
  role: TeamRole | null;
  /** 曾经是成员、现已移除（从没当过成员为 false） */
  removed: boolean;
};

/**
 * 某用户对某项目的团队身份。项目不存在或已归档返回 null。
 * 只看成员关系，不看 `projects.visibility`：团队可见只代表公司里登录的人能看访客级内容。
 */
export async function getTeamAccess(projectId: string, userId: string): Promise<TeamAccess | null> {
  const rows = await db
    .select({ ownerId: projects.ownerId, teamVersionId: repoState.teamVersionId })
    .from(projects)
    .leftJoin(repoState, eq(repoState.projectId, projects.id))
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const enabled = row.teamVersionId !== null;
  if (row.ownerId === userId) return { enabled, role: "lead", removed: false };
  const member = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
        isNull(projectMembers.removedAt),
      ),
    )
    .limit(1);
  if (member[0]) return { enabled, role: member[0].role, removed: false };
  const past = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return { enabled, role: null, removed: past.length > 0 };
}

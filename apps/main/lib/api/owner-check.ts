import { and, eq, isNull } from "drizzle-orm";
import { db, projects, versions } from "@prd-lab/core";
import type { Session } from "@/lib/api/auth-guard"; // import type 避免运行时循环依赖

/**
 * 项目可管理判定（mutation 鉴权统一入口）。
 * - owner 恒真
 * - 管理员（isAdmin）且项目 visibility==="team" 为真
 * - 他人 private 项目：管理员不可管（与可见性过滤正交，admin 也读不到）
 */
export function canManageProject(
  target: { ownerId: string; visibility: "private" | "team" },
  session: Pick<Session, "userId" | "isAdmin">,
): boolean {
  if (target.ownerId === session.userId) return true;
  return session.isAdmin === true && target.visibility === "team";
}

/**
 * 判断指定项目是否归属指定用户（owner）。
 * 仅查未归档项目。
 */
export async function isProjectOwner(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  return rows[0]?.ownerId === userId;
}

/**
 * 拿到 version 所属项目的 owner_id；找不到 / 已归档返回 null。
 */
export async function getVersionOwnerId(versionId: string): Promise<string | null> {
  const rows = await db
    .select({ ownerId: projects.ownerId })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(versions.id, versionId),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  return rows[0]?.ownerId ?? null;
}

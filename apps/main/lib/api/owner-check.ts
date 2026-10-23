import { and, eq, isNull } from "drizzle-orm";
import { db, projects, versions } from "@prd-lab/core";
import type { Session } from "@/lib/api/auth-guard"; // import type 避免运行时循环依赖

/** Editing and deletion are creator-only, independent of site or collaboration roles. */
export function canEditProject(
  target: { ownerId: string },
  session: Pick<Session, "userId">,
): boolean {
  return target.ownerId === session.userId;
}

/** Share configuration (including GET) is creator-only for every project kind. */
export function canManageProjectShares(
  target: { ownerId: string },
  session: Pick<Session, "userId">,
): boolean {
  return target.ownerId === session.userId;
}

/** Evaluate against the locked/current project row, not a client-supplied visibility. */
export function canChangeProjectVisibility(
  target: { ownerId: string; visibility: "private" | "team" },
  session: Pick<Session, "userId" | "isAdmin">,
  visibility: "private" | "team",
): boolean {
  return target.ownerId === session.userId ||
    (session.isAdmin && target.visibility === "team" && visibility === "private");
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

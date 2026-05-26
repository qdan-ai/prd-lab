import { and, eq, isNull } from "drizzle-orm";
import { db, projects, versions } from "@prd-lab/core";

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

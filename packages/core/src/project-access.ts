import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db/client";
import { projectMembers, projects } from "./db/schema";

/** Logged-in guest-content visibility. Bind to the outer `projects` table; never grants team-snapshot access. */
export function projectReadableBy(userId: string): SQL {
  return and(
    isNull(projects.archivedAt),
    or(
      eq(projects.visibility, "team"),
      eq(projects.ownerId, userId),
      and(
        eq(projects.kind, "repo"),
        sql`EXISTS (SELECT 1 FROM ${projectMembers}
          WHERE ${projectMembers.projectId} = ${projects.id}
          AND ${projectMembers.userId} = ${userId}
          AND ${projectMembers.removedAt} IS NULL)`,
      ),
    ),
  )!;
}

/** Rechecks current DB visibility/membership using an authenticated (or signed preview-token) user ID. */
export async function canReadProject(projectId: string, userId: string): Promise<boolean> {
  const rows = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), projectReadableBy(userId))).limit(1);
  return rows.length > 0;
}

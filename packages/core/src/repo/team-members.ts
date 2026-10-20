import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { mergeRequests, projectMembers, teamEvents, teamProgress, teamSealing, users } from "../db/schema";
import type { Member } from "./team-contract";
import { TeamError } from "./team-errors";
import { lockRepoState, type Conn } from "./team-snapshot";

type MemberRow = typeof projectMembers.$inferSelect;

function toMember(row: MemberRow, name: string): Member {
  return {
    user: { id: row.userId, name, removed: row.removedAt !== null },
    role: row.role,
    addedAt: row.addedAt.toISOString(),
    removedAt: row.removedAt ? row.removedAt.toISOString() : null,
  };
}

async function userName(userId: string, conn: Conn = db): Promise<string> {
  const rows = await conn.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.name ?? "未知用户";
}

/** 在册（未移除）成员，按加入先后。 */
export async function listMembers(projectId: string): Promise<Member[]> {
  const rows = await db
    .select({ m: projectMembers, name: users.name })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), isNull(projectMembers.removedAt)))
    .orderBy(projectMembers.addedAt, projectMembers.id);
  return rows.map((r) => toMember(r.m, r.name));
}

async function activeMember(projectId: string, userId: string, conn: Conn = db): Promise<MemberRow | null> {
  const rows = await conn
    .select()
    .from(projectMembers)
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId), isNull(projectMembers.removedAt)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** 按账号名加人。开启没完成一律 `team_not_ready`；找不到人 `user_not_found`；已是成员 `already_member`。 */
export async function addMember(
  projectId: string,
  actorId: string,
  input: { name: string; role: "admin" | "member" },
): Promise<Member> {
  return db.transaction(async (tx) => {
    const state = await lockRepoState(tx, projectId);
    if (!state?.teamReadyAt) throw new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作");
    const found = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.name, input.name), isNull(users.archivedAt)))
      .limit(1);
    const user = found[0];
    if (!user) {
      throw new TeamError("user_not_found", "没有这个账号，请对方先登录一次 PRD-Lab", { name: input.name });
    }
    const existing = await activeMember(projectId, user.id, tx);
    if (existing) {
      throw new TeamError("already_member", `${user.name}已是成员`, { member: toMember(existing, user.name) });
    }
    const id = randomUUID();
    await tx.insert(projectMembers).values({
      id,
      projectId,
      userId: user.id,
      role: input.role,
      addedBy: actorId,
    });
    const [row] = await tx.select().from(projectMembers).where(eq(projectMembers.id, id));
    await tx.insert(teamEvents).values({
      projectId,
      actorId,
      type: "member_added",
      payload: { userId: user.id, role: input.role },
    });
    return toMember(row!, user.name);
  });
}

/** 改角色。负责人（主人）的角色不能改。 */
export async function updateMemberRole(
  projectId: string,
  actorId: string,
  targetUserId: string,
  role: "admin" | "member",
): Promise<Member> {
  return db.transaction(async (tx) => {
    const target = await activeMember(projectId, targetUserId, tx);
    if (!target) throw new TeamError("not_found");
    if (target.role === "lead") throw new TeamError("lead_fixed", "负责人不能改角色或移除");
    if (target.role !== role) {
      await tx.update(projectMembers).set({ role }).where(eq(projectMembers.id, target.id));
      await tx.insert(teamEvents).values({
        projectId,
        actorId,
        type: "member_role_changed",
        payload: { userId: targetUserId, from: target.role, to: role },
      });
    }
    return toMember({ ...target, role }, await userName(targetUserId, tx));
  });
}

/**
 * 移除成员：写 `removed_at`，同一事务里撤回他的待审请求（原因 `member_removed`），清掉他的「正在封版」与进度摘要。
 * 负责人不能被移除。
 */
export async function removeMember(
  projectId: string,
  actorId: string,
  targetUserId: string,
): Promise<{ member: Member; withdrawnMrIds: string[] }> {
  return db.transaction(async (tx) => {
    // 与团队写入串行：移除之后，在途的写入再进来会被成员判断拦下
    await lockRepoState(tx, projectId);
    const target = await activeMember(projectId, targetUserId, tx);
    if (!target) throw new TeamError("not_found");
    if (target.role === "lead") throw new TeamError("lead_fixed", "负责人不能改角色或移除");
    const now = new Date();
    await tx
      .update(projectMembers)
      .set({ removedAt: now, removedBy: actorId })
      .where(eq(projectMembers.id, target.id));
    const open = await tx
      .select({ id: mergeRequests.id })
      .from(mergeRequests)
      .where(
        and(
          eq(mergeRequests.projectId, projectId),
          eq(mergeRequests.authorId, targetUserId),
          eq(mergeRequests.status, "open"),
        ),
      )
      .orderBy(mergeRequests.seq);
    const withdrawnMrIds = open.map((r) => r.id);
    if (withdrawnMrIds.length > 0) {
      await tx
        .update(mergeRequests)
        .set({ status: "withdrawn", withdrawReason: "member_removed", decidedAt: now, decidedBy: actorId })
        .where(inArray(mergeRequests.id, withdrawnMrIds));
    }
    await tx
      .delete(teamSealing)
      .where(and(eq(teamSealing.projectId, projectId), eq(teamSealing.userId, targetUserId)));
    await tx
      .delete(teamProgress)
      .where(and(eq(teamProgress.projectId, projectId), eq(teamProgress.userId, targetUserId)));
    await tx.insert(teamEvents).values({
      projectId,
      actorId,
      type: "member_removed",
      payload: { userId: targetUserId, withdrawnMrIds },
    });
    const removed = { ...target, removedAt: now, removedBy: actorId };
    return { member: toMember(removed, await userName(targetUserId, tx)), withdrawnMrIds };
  });
}

import { and, eq, isNull } from "drizzle-orm";
import { projectMembers, projects, teamEvents, type RepoState } from "../db/schema";
import { checkRepoPath, REPO_LIMITS } from "./manifest";
import type { PlainFiles } from "./team-contract";
import { TeamError, validationError } from "./team-errors";
import { assertClientFormat } from "./team-format";
import { roleAtLeast, type TeamRole } from "./team-guard";
import { loadBlobInfo, lockRepoState, type Tx } from "./team-snapshot";

/**
 * 团队写操作（接口 10 提交、11–16、21）的公共部分：锁内复核身份、回复的写法、事件、访客文件表的核对。
 *
 * 加锁顺序（所有团队写操作与移除成员都照这个顺序，同一项目的团队写入因此串行）：
 *   1. `repo_state` 行
 *   2. 调用者的 `project_members` 行（改角色只锁这一行，与在途写入靠它串行）
 * 事务的第一条语句必须是第 1 步的加锁读：之后的普通读才看得到锁到手之前已提交的全部写入。
 */

/** 接口的完整回复：状态码 + 响应体。按操作号幂等的接口把它原样存下、重试时原样返回。 */
export type TeamReply = { status: number; body: unknown };

/** 业务错误写成的回复（错误体同路由层 `teamErrorResponse`）。 */
export function errorReply(e: TeamError): TeamReply {
  return {
    status: e.status,
    body: { error_code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) },
  };
}

export type LockedTeam = {
  /** 锁住的 repo_state 行；团队方案一定已建 */
  state: RepoState & { teamVersionId: string };
  ownerId: string;
  role: TeamRole;
};

/**
 * 团队写操作的第一步（事务内）：锁 `repo_state` 行、锁调用者的成员行，在锁内复核项目仍在、
 * 调用者仍是未移除成员且角色够、团队已开启完成；带 `clientFormat` 时再核格式门槛。
 * 在入口检查与落库之间被移除、降级、或团队格式要求升高的，在这里失败，什么都不写。
 */
export async function lockTeamWrite(
  tx: Tx,
  projectId: string,
  userId: string,
  minRole: TeamRole,
  opts: { clientFormat?: number } = {},
): Promise<LockedTeam> {
  const state = await lockRepoState(tx, projectId);
  if (!state) throw new TeamError("not_found");
  const [project] = await tx
    .select({ ownerId: projects.ownerId, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project || project.archivedAt !== null) throw new TeamError("not_found");

  const [member] = await tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
        isNull(projectMembers.removedAt),
      ),
    )
    .for("update");
  let role: TeamRole;
  if (project.ownerId === userId) role = "lead";
  else if (member) role = member.role;
  else {
    const [past] = await tx
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    throw new TeamError(past ? "not_member" : "not_found");
  }
  if (!roleAtLeast(role, minRole)) {
    throw new TeamError("forbidden_role", "forbidden_role", { required: minRole, actual: role });
  }
  if (!state.teamVersionId || !state.teamReadyAt) {
    throw new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作");
  }
  if (opts.clientFormat !== undefined) await assertClientFormat(projectId, opts.clientFormat, tx);
  return { state: { ...state, teamVersionId: state.teamVersionId }, ownerId: project.ownerId, role };
}

export async function recordTeamEvent(
  tx: Tx,
  projectId: string,
  actorId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(teamEvents).values({ projectId, actorId, type, payload });
}

/**
 * 普通文件表（团队封版的访客部分、访客草稿，事务外核对）：路径合法、不含 `docs/discussions/`、
 * 每个文件都已上传（`blobs_missing`）、合计不超单版上限。
 * 返回文件列表与指纹 → 已登记的大小。
 */
export async function verifyPlainFiles(
  projectId: string,
  table: PlainFiles,
  opts: { discussions: "error_code" | "validation" },
): Promise<{ files: Array<{ path: string; sha256: string }>; sizes: Map<string, number> }> {
  const files = Object.entries(table).map(([path, f]) => ({ path, sha256: f.sha256 }));
  for (const f of files) {
    const bad = checkRepoPath(f.path);
    if (bad?.code === "discussions_not_allowed") {
      // 访客草稿（接口 21）有专门的错误码；封版（接口 15）的错误清单里没有，按请求不合法回
      if (opts.discussions === "error_code") throw new TeamError("discussions_not_allowed", bad.message, bad.details);
      throw validationError("discussions_not_allowed", { path: f.path });
    }
    if (bad) throw validationError("invalid_path", { path: f.path });
  }
  const info = await loadBlobInfo(
    projectId,
    files.map((f) => f.sha256),
  );
  const missing = [...new Set(files.map((f) => f.sha256))].filter((s) => !info.has(s));
  if (missing.length > 0) throw new TeamError("blobs_missing", `${missing.length} file(s) not uploaded yet`, { missing });
  const sizes = new Map([...info].map(([sha, b]) => [sha, b.sizeBytes]));
  const total = files.reduce((n, f) => n + (sizes.get(f.sha256) ?? 0), 0);
  if (total > REPO_LIMITS.maxBytesPerVersion) {
    throw validationError("version_too_large", { totalBytes: total, maxBytes: REPO_LIMITS.maxBytesPerVersion });
  }
  return { files, sizes };
}

import {
  asRepoProject,
  findProjectForRepo,
  getTeamAccess,
  RepoError,
  roleAtLeast,
  type RepoProject,
  type TeamRole,
} from "@prd-lab/core/repo";
import type { Session } from "@/lib/api/auth-guard";
import { canManageProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";

/** 仓库服务层的业务错误 → 标准错误响应；其他异常原样抛出。 */
export function repoErrorResponse(e: unknown): Response {
  if (e instanceof RepoError) return errorResponse(e.code, e.message, e.details);
  throw e;
}

/**
 * 取一个当前用户能管理（推送）的仓库项目。
 * 不存在 / 已归档 / 私有且不是 owner → not_found（防探测）；可读但不可管 → not_owner；普通项目 → not_repo。
 *
 * 已开启团队协作的项目改按团队角色判：
 *   - 不是成员（含网站管理员、已移除成员）→ not_owner；是成员但角色低于 `teamMin`（默认 member）→ forbidden_role。
 *   - 主人恒为负责人。
 */
export async function requireManagedRepo(
  pid: string,
  session: Pick<Session, "userId" | "isAdmin">,
  opts: { teamMin?: TeamRole } = {},
): Promise<RepoProject | Response> {
  const repo = await requireReadableRepo(pid, session);
  if (repo instanceof Response) return repo;
  const access = await getTeamAccess(pid, session.userId);
  if (access?.enabled) {
    if (access.role === null) return errorResponse("not_owner");
    if (!roleAtLeast(access.role, opts.teamMin ?? "member")) return errorResponse("forbidden_role");
    return repo;
  }
  if (!canManageProject(repo, session)) return errorResponse("not_owner");
  return repo;
}

/**
 * 取一个当前用户能读的仓库项目（team 可见、owner 或团队成员）。先判可读再判类型，无权者只得到 not_found。
 * 可读只代表能看访客级内容；团队内容走 {@link requireTeamRole}。
 */
export async function requireReadableRepo(
  pid: string,
  session: Pick<Session, "userId">,
): Promise<RepoProject | Response> {
  const row = await findProjectForRepo(pid);
  if (!row) return errorResponse("not_found");
  let canRead = row.visibility === "team" || row.ownerId === session.userId;
  if (!canRead) canRead = (await getTeamAccess(pid, session.userId))?.role != null;
  if (!canRead) return errorResponse("not_found");
  try {
    return asRepoProject(row);
  } catch (e) {
    return repoErrorResponse(e);
  }
}

/**
 * 团队接口的入口：取一个当前用户以不低于 `minRole` 的团队身份能进的仓库项目。
 *   1. 项目不存在 / 已归档 / 不是仓库项目 → not_found
 *   2. 不是主人，也不是未移除的成员 → 已移除的成员 403 not_member，其余 not_found（防探测；不看 `visibility`，网站管理员也一样）
 *   3. 角色低于 `minRole`（lead > admin > member）→ 403 forbidden_role
 * 不要求项目已开启团队协作：开启接口由负责人（主人）在开启前调用。
 */
export async function requireTeamRole(
  pid: string,
  session: Pick<Session, "userId">,
  minRole: TeamRole = "member",
): Promise<{ repo: RepoProject; role: TeamRole } | Response> {
  const row = await findProjectForRepo(pid);
  if (!row || !row.versionId) return errorResponse("not_found");
  const access = await getTeamAccess(pid, session.userId);
  if (!access) return errorResponse("not_found");
  // 已移除的成员得到 not_member（界面显示「你已不在团队」）；从没当过成员的人只得到 not_found
  if (access.role === null) return errorResponse(access.removed ? "not_member" : "not_found");
  if (!roleAtLeast(access.role, minRole)) {
    return errorResponse("forbidden_role", "forbidden_role", { required: minRole, actual: access.role });
  }
  return { repo: asRepoProject(row), role: access.role };
}

/** 主站分享页地址（项目级链接）。 */
export function shareUrl(origin: string, shareId: string): string {
  return `${origin}/share/${shareId}`;
}

/** 预览站对外 origin（与分享 / 快照重签端点同一取值）。 */
export function previewOrigin(): string {
  return process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? "http://preview.local";
}

const REPO_MANAGED_MESSAGES = {
  rename_version: "该项目由 G-canvas 仓库式推送维护，内置方案不能改名",
  delete_version: "该项目由 G-canvas 仓库式推送维护，内置方案不能单独删除；不再需要可以删除整个项目",
  edit_snapshot: "该项目由 G-canvas 仓库式推送维护，版本信息以 G-canvas 为准：请在 G-canvas 里修改后重新推送",
  delete_snapshot: "该项目由 G-canvas 仓库式推送维护，版本不能在网页上删除：请在 G-canvas 里撤销封版后重新推送",
  export: "该项目由 G-canvas 仓库式推送维护，不提供按方案导出：各版本内容以 G-canvas 本机为准，访客请用访客链接查看",
} as const;

/** 仓库项目的内置方案与版本只由仓库式推送维护：主站上的改名、删除、导出一律 409 repo_managed，并说明该去哪里改。 */
export function repoManagedResponse(action: keyof typeof REPO_MANAGED_MESSAGES): Response {
  return errorResponse("repo_managed", REPO_MANAGED_MESSAGES[action]);
}

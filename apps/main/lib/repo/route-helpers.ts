import { asRepoProject, findProjectForRepo, RepoError, type RepoProject } from "@prd-lab/core/repo";
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
 */
export async function requireManagedRepo(
  pid: string,
  session: Pick<Session, "userId" | "isAdmin">,
): Promise<RepoProject | Response> {
  const repo = await requireReadableRepo(pid, session);
  if (repo instanceof Response) return repo;
  if (!canManageProject(repo, session)) return errorResponse("not_owner");
  return repo;
}

/** 取一个当前用户能读的仓库项目（team 可见或 owner）。先判可读再判类型，无权者只得到 not_found。 */
export async function requireReadableRepo(
  pid: string,
  session: Pick<Session, "userId">,
): Promise<RepoProject | Response> {
  const row = await findProjectForRepo(pid);
  if (!row) return errorResponse("not_found");
  const canRead = row.visibility === "team" || row.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");
  try {
    return asRepoProject(row);
  } catch (e) {
    return repoErrorResponse(e);
  }
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
} as const;

/** 仓库项目的内置方案与版本只由仓库式推送维护：主站上的改名、删除一律 409 repo_managed，并说明该去哪里改。 */
export function repoManagedResponse(action: keyof typeof REPO_MANAGED_MESSAGES): Response {
  return errorResponse("repo_managed", REPO_MANAGED_MESSAGES[action]);
}

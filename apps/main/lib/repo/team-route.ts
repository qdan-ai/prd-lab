import {
  assertClientFormat,
  checkShape,
  loadTeamGate,
  parseTeamFormat,
  TeamError,
  TEAM_FORMAT_HEADER,
  type RepoProject,
  type Shape,
  type TeamRole,
} from "@prd-lab/core/repo";
import { getSession, type Session } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { repoErrorResponse, requireReadableRepo, requireTeamRole } from "@/lib/repo/route-helpers";

/** 团队业务错误 → 标准错误体（`error_code` 与状态一一对应；带 `Retry-After` 等头）。 */
export function teamErrorResponse(e: TeamError): Response {
  return Response.json(
    { error_code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) },
    { status: e.status, ...(e.headers ? { headers: e.headers } : {}) },
  );
}

/** 团队接口里捕获的异常 → 响应；团队错误、仓库服务层错误之外的原样抛出。 */
export function handleTeamError(e: unknown): Response {
  if (e instanceof TeamError) return teamErrorResponse(e);
  return repoErrorResponse(e);
}

export function validationResponse(reason: string, details?: Record<string, unknown>): Response {
  return errorResponse("validation_error", reason, details);
}

export type TeamCtx = {
  session: Session;
  repo: RepoProject;
  role: TeamRole;
  /** 请求头里的团队格式版本；接口不要求该头且没带时为 null */
  format: number | null;
};

export type TeamGuardOpts = {
  /** 最低角色，缺省成员 */
  minRole?: TeamRole;
  /** `required`（缺省）：缺头回 400 `missing_team_format`；`none`：不要求，带了也只是记下 */
  format?: "required" | "none";
  /** 格式门槛：头里的版本低于团队要求回 409 `client_too_old` */
  gated?: boolean;
  /** 开启没完成回 409 `team_not_ready`（缺省 true） */
  ready?: boolean;
};

/**
 * 团队接口的入口，按契约 1.4a 的顺序：登录 → 成员关系与角色（404 / 403）→ 格式头（400）→ 开启已完成（409）→ 格式门槛（409）。
 */
export async function teamGuard(request: Request, pid: string, opts: TeamGuardOpts = {}): Promise<TeamCtx | Response> {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const access = await requireTeamRole(pid, session, opts.minRole ?? "member");
  if (access instanceof Response) return access;

  let format: number | null = null;
  const header = request.headers.get(TEAM_FORMAT_HEADER);
  if ((opts.format ?? "required") === "required" || header !== null) {
    const parsed = parseTeamFormat(header);
    if (parsed.ok) format = parsed.format;
    else if ((opts.format ?? "required") === "required") return validationResponse(parsed.reason);
  }

  try {
    if (opts.ready !== false || opts.gated) {
      const gate = await loadTeamGate(pid);
      if (opts.ready !== false && !gate.ready) {
        return teamErrorResponse(new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作"));
      }
      if (opts.gated && format !== null) await assertClientFormat(pid, format);
    }
  } catch (e) {
    return handleTeamError(e);
  }
  return { session, repo: access.repo, role: access.role, format };
}

/** 读请求体 JSON；不是合法 JSON → 400 `invalid_json`。 */
export async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return validationResponse("invalid_json");
  }
}

/** 按契约形状核对请求体；不符 → 400 `invalid_body`，`details.problems` 列出前几处。 */
export function checkBody<T>(body: unknown, shape: Shape<T>, reason = "invalid_body"): T | Response {
  const problems = checkShape(shape, body, "body");
  if (problems.length > 0) return validationResponse(reason, { problems: problems.slice(0, 10) });
  return body as T;
}

/** 按契约形状核对查询参数（全是字符串）；不符 → 400 `invalid_query`。 */
export function checkQuery<T>(url: URL, shape: Shape<T>): T | Response {
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  const problems = checkShape(shape, query, "query");
  if (problems.length > 0) return validationResponse("invalid_query", { problems: problems.slice(0, 10) });
  return query as T;
}

/**
 * 开启团队协作的入口（接口 17）：只有项目主人（即负责人）能用。看不到项目 → 404，看得到但不是主人 → 403 not_owner，
 * 不是仓库项目 → 409 not_repo。不要求项目已开启。
 */
export async function requireTeamInitOwner(
  pid: string,
  session: Pick<Session, "userId" | "isAdmin">,
): Promise<RepoProject | Response> {
  const repo = await requireReadableRepo(pid, session);
  if (repo instanceof Response) return repo;
  if (repo.ownerId !== session.userId) return errorResponse("not_owner");
  return repo;
}

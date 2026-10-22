import { MrListQuery, MrSubmitRequest, TEAM_LIMITS, listMrs, submitMr } from "@prd-lab/core/repo";
import { checkBody, checkQuery, readJson, teamGuard, teamReply, validationResponse } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string }> };

/** POST /api/v1/repos/:pid/team/mrs — 提交合并请求（成员；格式门槛；按操作号幂等） */
export async function POST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid, { gated: true });
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const line = (raw as { line?: unknown } | null)?.line;
  if (typeof line === "string" && line !== "main") return validationResponse("line_not_supported", { line });
  const body = checkBody(raw, MrSubmitRequest);
  if (body instanceof Response) return body;
  return teamReply(() => submitMr(ctx.repo.id, ctx.session.userId, body, ctx.format!));
}

/** GET /api/v1/repos/:pid/team/mrs?state=open|all&limit=&after= — 合并请求列表（成员） */
export async function GET(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid);
  if (ctx instanceof Response) return ctx;
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit");
  if (limit !== null && !/^([1-9][0-9]?|100)$/.test(limit)) {
    return validationResponse("invalid_limit", { max: TEAM_LIMITS.pageMax });
  }
  const after = url.searchParams.get("after");
  if (after !== null && !/^[1-9][0-9]{0,9}$/.test(after)) return validationResponse("invalid_cursor");
  const query = checkQuery(url, MrListQuery);
  if (query instanceof Response) return query;
  return teamReply(async () => ({
    status: 200,
    body: await listMrs(ctx.repo.id, ctx.repo.ownerId, {
      state: query.state ?? "open",
      limit: limit ? Number(limit) : TEAM_LIMITS.pageDefault,
      after: after ? Number(after) : null,
    }),
  }));
}

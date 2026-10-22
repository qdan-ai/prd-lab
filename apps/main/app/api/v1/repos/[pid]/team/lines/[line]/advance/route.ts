import { AdvanceRequest, advanceLine } from "@prd-lab/core/repo";
import { checkBody, lineParam, readJson, teamGuard, teamReply } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string; line: string }> };

/** POST /api/v1/repos/:pid/team/lines/:line/advance — 合入（管理员及以上；格式门槛；按操作号幂等） */
export async function POST(request: Request, { params }: Ctx) {
  const { pid, line } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin", gated: true });
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const body = checkBody(raw, AdvanceRequest);
  if (body instanceof Response) return body;
  return teamReply(() => advanceLine(ctx.repo.id, ctx.session.userId, lineParam(line), body, ctx.format!));
}

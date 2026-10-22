import { LineId, SealRequest, checkShape, sealLine } from "@prd-lab/core/repo";
import { checkBody, lineParam, readJson, teamGuard, teamReply, validationResponse } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string; line: string }> };

/** POST /api/v1/repos/:pid/team/lines/:line/seal — 团队封版（管理员及以上；格式门槛；按操作号幂等） */
export async function POST(request: Request, { params }: Ctx) {
  const { pid, line: rawLine } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin", gated: true });
  if (ctx instanceof Response) return ctx;
  const line = lineParam(rawLine);
  if (checkShape(LineId, line).length > 0) return validationResponse("invalid_line", { line });
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const body = checkBody(raw, SealRequest);
  if (body instanceof Response) return body;
  return teamReply(() => sealLine(ctx.repo.id, ctx.session.userId, line, body, ctx.format!));
}

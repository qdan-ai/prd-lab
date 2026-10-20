import { OnlinePutRequest, putOnline } from "@prd-lab/core/repo";
import { checkBody, readJson, teamGuard, teamReply } from "@/lib/repo/team-route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string }> };

/** PUT /api/v1/repos/:pid/team/online — 上线标记的一次明确操作（管理员及以上；格式门槛） */
export async function PUT(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin", gated: true });
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const body = checkBody(raw, OnlinePutRequest);
  if (body instanceof Response) return body;
  return teamReply(() => putOnline(ctx.repo.id, ctx.session.userId, body, ctx.format!));
}

import { MrWithdrawRequest, withdrawMr } from "@prd-lab/core/repo";
import { checkBody, readJson, teamGuard, teamReply } from "@/lib/repo/team-route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string; id: string }> };

/** POST /api/v1/repos/:pid/team/mrs/:id/withdraw — 作者撤回自己待审的请求 */
export async function POST(request: Request, { params }: Ctx) {
  const { pid, id } = await params;
  const ctx = await teamGuard(request, pid);
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const body = checkBody(raw, MrWithdrawRequest);
  if (body instanceof Response) return body;
  return teamReply(() => withdrawMr(ctx.repo.id, ctx.session.userId, id));
}

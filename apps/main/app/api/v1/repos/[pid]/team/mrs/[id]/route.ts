import { getMr } from "@prd-lab/core/repo";
import { teamGuard, teamReply } from "@/lib/repo/team-route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string; id: string }> };

/** GET /api/v1/repos/:pid/team/mrs/:id — 合并请求详情（成员） */
export async function GET(request: Request, { params }: Ctx) {
  const { pid, id } = await params;
  const ctx = await teamGuard(request, pid);
  if (ctx instanceof Response) return ctx;
  return teamReply(async () => ({ status: 200, body: { mr: await getMr(ctx.repo.id, ctx.repo.ownerId, id) } }));
}

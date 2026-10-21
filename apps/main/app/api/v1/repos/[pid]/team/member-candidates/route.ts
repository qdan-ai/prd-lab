import { listMemberCandidates } from "@prd-lab/core/repo";
import { teamGuard } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * GET …/team/member-candidates   成员页「添加成员」选人框的候选：全部账号的 `{ id, name, inTeam }`，
 * 一次给全，由网页按关键词过滤。与加人同一道门：只有负责人可用，开启没完成也可读。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid, { minRole: "lead", format: "none", ready: false });
  if (guard instanceof Response) return guard;
  return Response.json({ users: await listMemberCandidates(pid) });
}

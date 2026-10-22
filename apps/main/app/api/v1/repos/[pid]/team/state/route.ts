import { loadTeamState, StateQuery } from "@prd-lab/core/repo";
import { checkQuery, handleTeamError, teamGuard } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * GET …/team/state?line=&baseRev=&appliedStateRev=
 * 只读同一份团队状态：不并编号账、不存进度。成员可用，格式头必带。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid);
  if (guard instanceof Response) return guard;
  const query = checkQuery(new URL(request.url), StateQuery);
  if (query instanceof Response) return query;
  try {
    const state = await loadTeamState(
      pid,
      { userId: guard.session.userId, role: guard.role },
      {
        appliedStateRev: query.appliedStateRev === undefined ? null : Number(query.appliedStateRev),
        line: query.line ?? "main",
        baseRev: query.baseRev === undefined ? null : Number(query.baseRev),
      },
    );
    return Response.json(state);
  } catch (e) {
    return handleTeamError(e);
  }
}

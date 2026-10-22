import { checkIncomingLedger, refreshTeam, RefreshRequest } from "@prd-lab/core/repo";
import { checkBody, handleTeamError, readJson, teamGuard } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST …/team/refresh  { appliedStateRev, ids, progress }
 * 一次往返：并入编号账、存这台设备在这条线上的进度摘要、返回团队状态。成员可用，格式头必带（不设门槛）。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid);
  if (guard instanceof Response) return guard;
  const json = await readJson(request);
  if (json instanceof Response) return json;
  try {
    checkIncomingLedger((json as { ids?: unknown } | null)?.ids);
  } catch (e) {
    return handleTeamError(e);
  }
  const body = checkBody(json, RefreshRequest);
  if (body instanceof Response) return body;
  try {
    const state = await refreshTeam(pid, { userId: guard.session.userId, role: guard.role }, body);
    return Response.json(state);
  } catch (e) {
    return handleTeamError(e);
  }
}

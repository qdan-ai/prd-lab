import { getInitStatus } from "@prd-lab/core/repo";
import { errorResponse } from "@/lib/api/errors";
import { getSession } from "@/lib/api/auth-guard";
import { handleTeamError, requireTeamInitOwner } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string; initId: string }> };

/** GET …/team/init/:initId   断线后查这次开启已收到什么。项目主人可用。 */
export async function GET(_request: Request, { params }: Ctx) {
  const { pid, initId } = await params;
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const repo = await requireTeamInitOwner(pid, session);
  if (repo instanceof Response) return repo;
  try {
    return Response.json(await getInitStatus(repo, session.userId, initId));
  } catch (e) {
    return handleTeamError(e);
  }
}

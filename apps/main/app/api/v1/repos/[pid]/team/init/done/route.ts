import { completeInit, InitDoneRequest } from "@prd-lab/core/repo";
import { errorResponse } from "@/lib/api/errors";
import { getSession } from "@/lib/api/auth-guard";
import { checkBody, handleTeamError, readJson, requireTeamInitOwner } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string }> };

/** POST …/team/init/done  { initId, versionKeys }   完成开启：核对全部版本齐备才置「团队数据已就绪」。项目主人可用。 */
export async function POST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const repo = await requireTeamInitOwner(pid, session);
  if (repo instanceof Response) return repo;
  const json = await readJson(request);
  if (json instanceof Response) return json;
  const body = checkBody(json, InitDoneRequest);
  if (body instanceof Response) return body;
  try {
    return Response.json(await completeInit(repo, session.userId, body));
  } catch (e) {
    return handleTeamError(e);
  }
}

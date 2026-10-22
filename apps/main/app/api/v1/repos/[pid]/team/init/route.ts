import { InitRequest, parseTeamFormat, receiveInitBatch, TEAM_FORMAT_HEADER } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { checkBody, handleTeamError, readJson, requireTeamInitOwner } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST …/team/init  { initId?, batchSeq, versions, start?, head?, ids? }   开启团队协作：收一批。
 * 项目主人可用；第一次不带 initId（服务端建团队方案），之后每批带上。同一批重发得到同样的结果。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const repo = await requireTeamInitOwner(pid, session);
  if (repo instanceof Response) return repo;
  const format = parseTeamFormat(request.headers.get(TEAM_FORMAT_HEADER));
  if (!format.ok) return errorResponse("validation_error", format.reason);
  const json = await readJson(request);
  if (json instanceof Response) return json;
  const body = checkBody(json, InitRequest);
  if (body instanceof Response) return body;
  try {
    return Response.json(await receiveInitBatch(repo, session.userId, body, format.format));
  } catch (e) {
    return handleTeamError(e);
  }
}

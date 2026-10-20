import { listMyTeamProjects, parseTeamFormat, TEAM_FORMAT_HEADER } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { validationResponse } from "@/lib/repo/team-route";

/**
 * GET /api/v1/team/projects   我所在的、开启已完成的团队项目（首页卡片与角标一次拿全）。
 * 格式头必带。
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const format = parseTeamFormat(request.headers.get(TEAM_FORMAT_HEADER));
  if (!format.ok) return validationResponse(format.reason);
  return Response.json({ projects: await listMyTeamProjects(session.userId) });
}

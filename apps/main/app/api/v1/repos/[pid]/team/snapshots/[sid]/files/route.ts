import { loadProjectSnapshotFiles } from "@prd-lab/core/repo";
import { handleTeamError, teamGuard } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string; sid: string }> };

/**
 * GET …/team/snapshots/:sid/files   读一份文件表（本项目团队方案或内置方案下的快照）。
 * 成员可用，格式头必带，有格式门槛。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid, sid } = await params;
  const guard = await teamGuard(request, pid, { gated: true });
  if (guard instanceof Response) return guard;
  try {
    return Response.json(await loadProjectSnapshotFiles(pid, sid));
  } catch (e) {
    return handleTeamError(e);
  }
}

import { DiscussionsPutRequest, listDiscussions, putDiscussions } from "@prd-lab/core/repo";
import { checkBody, handleTeamError, readJson, teamGuard } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string }> };

/** GET …/team/discussions   各作者最新一份讨论。成员可用，格式头必带。 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid);
  if (guard instanceof Response) return guard;
  return Response.json({ authors: await listDiscussions(guard.repo) });
}

/**
 * PUT …/team/discussions  { files, baseSnapshotId? }   整份替换我的讨论文件表；baseSnapshotId 不是现存那份 → 409 discussions_moved。
 * 成员可用，格式头必带，有格式门槛。
 */
export async function PUT(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid, { gated: true });
  if (guard instanceof Response) return guard;
  const json = await readJson(request);
  if (json instanceof Response) return json;
  const body = checkBody(json, DiscussionsPutRequest);
  if (body instanceof Response) return body;
  try {
    return Response.json(await putDiscussions(guard.repo, guard.session.userId, body.files, guard.format ?? 1, body.baseSnapshotId));
  } catch (e) {
    return handleTeamError(e);
  }
}

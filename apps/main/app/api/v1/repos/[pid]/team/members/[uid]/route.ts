import { MemberUpdateRequest, removeMember, updateMemberRole } from "@prd-lab/core/repo";
import { checkBody, handleTeamError, readJson, teamGuard, validationResponse } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string; uid: string }> };

/** PATCH …/team/members/:uid  { role: admin | member }   改角色。负责人可用；负责人自己的角色不能改。 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { pid, uid } = await params;
  const guard = await teamGuard(request, pid, { minRole: "lead", format: "none", ready: false });
  if (guard instanceof Response) return guard;
  const json = await readJson(request);
  if (json instanceof Response) return json;
  const role = (json as { role?: unknown } | null)?.role;
  if (role !== "admin" && role !== "member") return validationResponse("invalid_role", { role });
  const body = checkBody(json, MemberUpdateRequest);
  if (body instanceof Response) return body;
  try {
    return Response.json({ member: await updateMemberRole(pid, guard.session.userId, uid, body.role) });
  } catch (e) {
    return handleTeamError(e);
  }
}

/** DELETE …/team/members/:uid   移除成员，并撤回他的待审请求。负责人可用；负责人不能被移除。 */
export async function DELETE(request: Request, { params }: Ctx) {
  const { pid, uid } = await params;
  const guard = await teamGuard(request, pid, { minRole: "lead", format: "none", ready: false });
  if (guard instanceof Response) return guard;
  try {
    return Response.json(await removeMember(pid, guard.session.userId, uid));
  } catch (e) {
    return handleTeamError(e);
  }
}

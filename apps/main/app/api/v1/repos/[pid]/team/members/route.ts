import { addMember, listMembers, MemberAddRequest } from "@prd-lab/core/repo";
import { checkBody, handleTeamError, readJson, teamGuard, validationResponse } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string }> };

/** GET …/team/members   在册成员（不含已移除的）。成员可读。 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid, { format: "none" });
  if (guard instanceof Response) return guard;
  return Response.json({ members: await listMembers(pid) });
}

/** POST …/team/members  { name, role: admin | member }   按账号名加人。负责人可用；开启没完成回 409 team_not_ready。 */
export async function POST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid, { minRole: "lead", format: "none", ready: false });
  if (guard instanceof Response) return guard;
  const json = await readJson(request);
  if (json instanceof Response) return json;
  const role = (json as { role?: unknown } | null)?.role;
  if (role !== undefined && role !== "admin" && role !== "member") return validationResponse("invalid_role", { role });
  const body = checkBody(json, MemberAddRequest);
  if (body instanceof Response) return body;
  try {
    const member = await addMember(pid, guard.session.userId, body);
    return Response.json({ member }, { status: 201 });
  } catch (e) {
    return handleTeamError(e);
  }
}

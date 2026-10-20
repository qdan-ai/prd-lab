import { DeviceId, LineId, SealingDeleteQuery, SealingPutRequest, checkShape, deleteSealing, putSealing } from "@prd-lab/core/repo";
import { checkBody, checkQuery, readJson, teamGuard, teamReply, validationResponse } from "@/lib/repo/team-route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string }> };

/** 线、设备号不合法时给具体的原因码 */
function precheck(raw: unknown): Response | null {
  const v = (raw ?? {}) as { line?: unknown; deviceId?: unknown };
  if (checkShape(LineId, v.line).length > 0) return validationResponse("invalid_line");
  if (checkShape(DeviceId, v.deviceId).length > 0) return validationResponse("invalid_device_id");
  return null;
}

/** PUT /api/v1/repos/:pid/team/sealing — 上报 / 续报「正在封版」（管理员及以上） */
export async function PUT(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin" });
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const bad = precheck(raw);
  if (bad) return bad;
  const body = checkBody(raw, SealingPutRequest);
  if (body instanceof Response) return body;
  return teamReply(() => putSealing(ctx.repo.id, ctx.session.userId, body));
}

/** DELETE /api/v1/repos/:pid/team/sealing?line=&deviceId= — 清掉我这台设备在这条线上的「正在封版」 */
export async function DELETE(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin" });
  if (ctx instanceof Response) return ctx;
  const url = new URL(request.url);
  const bad = precheck(Object.fromEntries(url.searchParams));
  if (bad) return bad;
  const query = checkQuery(url, SealingDeleteQuery);
  if (query instanceof Response) return query;
  return teamReply(() => deleteSealing(ctx.repo.id, ctx.session.userId, query));
}

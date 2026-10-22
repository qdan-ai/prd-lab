import { GuestDraftDeleteQuery, GuestDraftPutRequest, deleteGuestDraft, putGuestDraft } from "@prd-lab/core/repo";
import { checkBody, checkQuery, readJson, teamGuard, teamReply, validationResponse } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string }> };

/** PUT /api/v1/repos/:pid/team/guest-draft — 把团队主线某个 rev 发给访客（管理员及以上；格式门槛） */
export async function PUT(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin", gated: true });
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const line = (raw as { line?: unknown } | null)?.line;
  if (typeof line === "string" && line !== "main") return validationResponse("line_not_supported", { line });
  const body = checkBody(raw, GuestDraftPutRequest);
  if (body instanceof Response) return body;
  return teamReply(() => putGuestDraft(ctx.repo.id, ctx.session.userId, body, ctx.format!));
}

/** DELETE /api/v1/repos/:pid/team/guest-draft?appliedStateRev= — 撤下访客草稿（管理员及以上） */
export async function DELETE(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin" });
  if (ctx instanceof Response) return ctx;
  const url = new URL(request.url);
  const applied = url.searchParams.get("appliedStateRev");
  if (applied === null || !/^(0|[1-9][0-9]{0,8})$/.test(applied)) return validationResponse("invalid_applied_state_rev");
  const query = checkQuery(url, GuestDraftDeleteQuery);
  if (query instanceof Response) return query;
  return teamReply(() => deleteGuestDraft(ctx.repo.id, ctx.session.userId, Number(query.appliedStateRev)));
}

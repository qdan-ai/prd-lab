import { MrReturnRequest, TEAM_LIMITS, returnMr } from "@prd-lab/core/repo";
import { checkBody, readJson, teamGuard, teamReply, validationResponse } from "@/lib/repo/team-route";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string; id: string }> };

/** POST /api/v1/repos/:pid/team/mrs/:id/return — 退回（管理员及以上，附一句原因） */
export async function POST(request: Request, { params }: Ctx) {
  const { pid, id } = await params;
  const ctx = await teamGuard(request, pid, { minRole: "admin" });
  if (ctx instanceof Response) return ctx;
  const raw = await readJson(request);
  if (raw instanceof Response) return raw;
  const note = (raw as { note?: unknown } | null)?.note;
  if (note === undefined || note === "") return validationResponse("note_required");
  if (typeof note === "string" && note.length > TEAM_LIMITS.returnNoteMax) {
    return validationResponse("note_too_long", { max: TEAM_LIMITS.returnNoteMax });
  }
  const body = checkBody(raw, MrReturnRequest);
  if (body instanceof Response) return body;
  return teamReply(() => returnMr(ctx.repo.id, ctx.session.userId, id, body.note));
}

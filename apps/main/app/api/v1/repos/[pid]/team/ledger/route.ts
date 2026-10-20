import {
  checkIncomingLedger,
  grantLedgerIds,
  LedgerRequest,
  TEAM_LIMITS,
} from "@prd-lab/core/repo";
import { checkBody, handleTeamError, readJson, teamGuard, validationResponse } from "@/lib/repo/team-route";

type Ctx = { params: Promise<{ pid: string }> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * POST …/team/ledger  { ids, want }   领新号：先并入 ids（按项取较大值），再给每项领出 want 里要的个数。成员可用，格式头必带。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { pid } = await params;
  const guard = await teamGuard(request, pid);
  if (guard instanceof Response) return guard;
  const json = await readJson(request);
  if (json instanceof Response) return json;
  if (isRecord(json)) {
    try {
      checkIncomingLedger(json["ids"]);
    } catch (e) {
      return handleTeamError(e);
    }
    const want = json["want"];
    if (isRecord(want)) {
      for (const part of [want["elements"], want["states"]]) {
        if (!isRecord(part)) continue;
        if (Object.values(part).some((n) => typeof n === "number" && n > TEAM_LIMITS.ledgerMaxWant)) {
          return validationResponse("want_too_many", { max: TEAM_LIMITS.ledgerMaxWant });
        }
      }
    }
  }
  const body = checkBody(json, LedgerRequest);
  if (body instanceof Response) return body;
  try {
    return Response.json(await grantLedgerIds(pid, body.ids, body.want));
  } catch (e) {
    return handleTeamError(e);
  }
}

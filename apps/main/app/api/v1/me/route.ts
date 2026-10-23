import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { getAccountProfile, updateAccountProfile } from "@/lib/auth/accounts";
import { readAccountBody } from "@/lib/auth/account-input";
import { accountErrorResponse } from "@/lib/auth/account-errors";

/** Keep id/name/authVia at the top level for existing CLI consumers. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");
    return Response.json({ ...await getAccountProfile(session), authVia: session.tokenId ? "api_token" : "session" });
  } catch (error) { return accountErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");
    return Response.json({ ...await updateAccountProfile(session, await readAccountBody(request)), authVia: session.tokenId ? "api_token" : "session" });
  } catch (error) { return accountErrorResponse(error); }
}

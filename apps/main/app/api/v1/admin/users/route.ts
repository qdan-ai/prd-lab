import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { listAccounts } from "@/lib/auth/accounts";
import { accountErrorResponse } from "@/lib/auth/account-errors";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");
    return Response.json({ users: await listAccounts(session) });
  } catch (error) { return accountErrorResponse(error); }
}

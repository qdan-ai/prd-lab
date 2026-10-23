import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { changeAccountPassword } from "@/lib/auth/accounts";
import { readAccountBody } from "@/lib/auth/account-input";
import { accountErrorResponse } from "@/lib/auth/account-errors";
import { reauthenticateAccount } from "@/lib/auth/account-reauthenticate";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");
    const credentials = await changeAccountPassword(session, await readAccountBody(request));
    const authentication = session.tokenId
      ? { authenticated: true, reauthRequired: false }
      : await reauthenticateAccount(credentials.identifier, credentials.password);
    return Response.json({ passwordUpdated: true, ...authentication });
  } catch (error) { return accountErrorResponse(error); }
}

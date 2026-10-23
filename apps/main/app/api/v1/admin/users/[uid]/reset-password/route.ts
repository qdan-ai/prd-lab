import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { resetAccountPassword } from "@/lib/auth/accounts";
import { readAccountBody } from "@/lib/auth/account-input";
import { accountErrorResponse } from "@/lib/auth/account-errors";

export async function POST(request: Request, context: { params: Promise<{ uid: string }> }) {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");
    const { uid } = await context.params;
    return Response.json(await resetAccountPassword(session, uid, await readAccountBody(request)));
  } catch (error) { return accountErrorResponse(error); }
}

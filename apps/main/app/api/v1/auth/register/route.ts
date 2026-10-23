import { registerAccount } from "@/lib/auth/accounts";
import { readAccountBody } from "@/lib/auth/account-input";
import { accountErrorResponse } from "@/lib/auth/account-errors";
import { reauthenticateAccount } from "@/lib/auth/account-reauthenticate";

export async function POST(request: Request) {
  try {
    const { user, password } = await registerAccount(await readAccountBody(request));
    const authentication = await reauthenticateAccount(user.name, password);
    return Response.json({ user, registered: true, ...authentication }, { status: 201 });
  } catch (error) { return accountErrorResponse(error); }
}

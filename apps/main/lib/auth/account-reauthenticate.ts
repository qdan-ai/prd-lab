import { signIn } from "@/auth";
import { accountErrorResponse } from "./account-errors";

/** Only call after the account transaction commits, using server-selected identity + validated password. */
export async function reauthenticateAccount(identifier: string, password: string) {
  try {
    await signIn("credentials", { identifier, password, redirect: false, redirectTo: "/" });
    return { authenticated: true as const, reauthRequired: false as const };
  } catch (error) {
    // The mutation already committed. Never present this as a failed write that should be replayed.
    let reauthError: { status: number; error_code: string; details?: Record<string, unknown> };
    try {
      const response = accountErrorResponse(error);
      const body = await response.json();
      reauthError = { status: response.status, error_code: body.error_code, ...(body.details ? { details: body.details } : {}) };
    } catch {
      reauthError = { status: 401, error_code: "unauthorized" };
    }
    return { authenticated: false as const, reauthRequired: true as const, reauthError };
  }
}

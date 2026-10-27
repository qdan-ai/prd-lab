"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { accountUsesSharedPassword } from "@/lib/auth/credentials";
import { safeCallbackUrl } from "@/lib/account-ui/safe-callback";
import { personalPasswordUrl } from "@/lib/account-ui/personal-password";
import { loginErrorState, type LoginState } from "@/lib/account-ui/login-error";

/** Accounts still on the shared password set a personal password before reaching the callback. */
export async function loginAction(callback: string, _state: LoginState, data: FormData): Promise<LoginState> {
  const identifier = String(data.get("identifier") ?? "");
  const destination = safeCallbackUrl(callback);
  try {
    await signIn("credentials", {
      identifier,
      password: String(data.get("password") ?? ""),
      redirect: false,
    });
  } catch (error) {
    return loginErrorState(error);
  }
  let shared: boolean;
  try {
    shared = await accountUsesSharedPassword(identifier);
  } catch {
    // Signed in already; the password page rechecks the account and forwards personal accounts.
    shared = true;
  }
  redirect(shared ? personalPasswordUrl(destination) : destination);
}

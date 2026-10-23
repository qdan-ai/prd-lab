"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/account-ui/safe-callback";
import { loginErrorState, type LoginState } from "@/lib/account-ui/login-error";

export async function loginAction(callback: string, _state: LoginState, data: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      identifier: String(data.get("identifier") ?? ""),
      password: String(data.get("password") ?? ""),
      redirectTo: safeCallbackUrl(callback),
    });
    return { message: "登录未完成，请重试" };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return loginErrorState(error);
  }
}

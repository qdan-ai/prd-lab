import { AuthError } from "next-auth";
import { AuthenticationUnavailableError, LoginLockedError } from "@/lib/auth/errors";

export type LoginState = { message: string; lockedUntil?: string; status?: number };

export function loginErrorState(error: unknown, now = Date.now()): LoginState {
  let current = error;
  let credentials = false;
  for (let i = 0; i < 8 && current; i++) {
    if (current instanceof LoginLockedError) {
      const seconds = Math.max(1, Math.ceil((current.lockedUntil.getTime() - now) / 1000));
      return { message: `尝试次数过多，请等待 ${seconds} 秒后重试`, lockedUntil: current.lockedUntil.toISOString(), status: 429 };
    }
    if (current instanceof AuthenticationUnavailableError) {
      return { message: "登录服务暂时不可用（503），请稍后重试", status: 503 };
    }
    if (current instanceof AuthError && current.type === "CredentialsSignin") credentials = true;
    const cause: unknown = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
    current = cause && typeof cause === "object" && "err" in cause ? cause.err : cause;
  }
  return credentials ? { message: "账号或密码错误", status: 401 } : { message: "登录服务暂时不可用，请稍后重试", status: 503 };
}

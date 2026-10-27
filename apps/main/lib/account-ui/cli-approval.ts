import { accountErrorResponse } from "@/lib/auth/account-errors";
import { personalPasswordUrl } from "./personal-password";

/** What the CLI authorisation page shows after a failed approval; each link is a local path. */
export type CliApprovalState = { message: string; login?: string; reopen?: string; setPassword?: string };

/**
 * Maps a failed token issuance to the authorisation page's message. Unexpected errors propagate.
 * @param back the authorisation page itself (cb / state / client included), so every detour returns to it
 */
export async function cliApprovalFailure(error: unknown, back: string, login: string): Promise<CliApprovalState> {
  const response = accountErrorResponse(error);
  if (response.status === 401) return { message: "登录已失效，请重新登录后授权。", login };
  if (response.status === 503) return { message: "认证服务暂时不可用，请稍后重试。" };
  const body = (await response.json()) as { error_code?: string };
  if (body.error_code === "personal_password_required") {
    return {
      message: "当前账号还在使用团队共享密码，需先设置个人密码才能授权 CLI。设置完成后会回到本页。",
      setPassword: personalPasswordUrl(back),
    };
  }
  throw error;
}

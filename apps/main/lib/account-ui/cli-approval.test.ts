/** CLI 授权页签 token 失败时给人看的提示：共享密码账户引导去设个人密码，设完回到原授权地址。 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => {
  class AuthError extends Error { type = "AuthError"; }
  class CredentialsSignin extends AuthError { override type = "CredentialsSignin"; }
  return { AuthError, CredentialsSignin };
});
vi.mock("@/lib/api/errors", () => import("../api/errors"));
vi.mock("@/lib/auth/account-errors", () => import("../auth/account-errors"));

import { AccountError } from "../auth/account-errors";
import { cliApprovalFailure } from "./cli-approval";

const BACK = `/cli/auth?cb=${encodeURIComponent("http://127.0.0.1:8765/callback")}&state=s-1&client=${encodeURIComponent("my-mac")}`;
const LOGIN = `/login?reauth=1&callbackUrl=${encodeURIComponent(BACK)}`;

describe("cliApprovalFailure", () => {
  it("还在用共享密码：提示先设个人密码，链接到设密码页并带回原授权地址", async () => {
    const state = await cliApprovalFailure(new AccountError("personal_password_required"), BACK, LOGIN);
    expect(state.message).toContain("个人密码");
    const url = new URL(state.setPassword!, "http://app.test");
    expect(url.pathname).toBe("/settings/password");
    expect(url.searchParams.get("callbackUrl")).toBe(BACK);
    expect(state.login).toBeUndefined();
  });

  it("登录失效：给重新登录的链接", async () => {
    expect(await cliApprovalFailure(new AccountError("unauthorized"), BACK, LOGIN))
      .toEqual({ message: "登录已失效，请重新登录后授权。", login: LOGIN });
  });

  it("其他账户错误原样抛出", async () => {
    const error = new AccountError("not_admin");
    await expect(cliApprovalFailure(error, BACK, LOGIN)).rejects.toBe(error);
  });
});

/**
 * 老账户（没有个人密码）用团队共享密码登录后，先去设个人密码，设完回到原来的 callbackUrl；
 * CLI 授权页 /cli/auth?cb=…&state=…&client=… 一路原样带回。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signIn: vi.fn(async (..._args: unknown[]) => "/"),
  shared: false,
}));

class Redirect extends Error {
  constructor(public readonly url: string) { super(url); }
}

vi.mock("next-auth", () => {
  class AuthError extends Error { type = "AuthError"; }
  class CredentialsSignin extends AuthError { override type = "CredentialsSignin"; }
  return { AuthError, CredentialsSignin };
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("@/auth", () => ({ signIn: h.signIn }));
vi.mock("@/lib/auth/credentials", () => ({ accountUsesSharedPassword: async () => h.shared }));
vi.mock("@/lib/auth/errors", () => import("../../lib/auth/errors"));
vi.mock("@/lib/account-ui/safe-callback", () => import("../../lib/account-ui/safe-callback"));
vi.mock("@/lib/account-ui/personal-password", () => import("../../lib/account-ui/personal-password"));
vi.mock("@/lib/account-ui/login-error", () => import("../../lib/account-ui/login-error"));

import { CredentialsSignin } from "next-auth";
import { loginAction } from "./actions";
import { afterPasswordUpdate } from "../../lib/account-ui/personal-password";

const CLI = `/cli/auth?cb=${encodeURIComponent("http://127.0.0.1:8765/callback")}&state=s-123&client=${encodeURIComponent("my-mac")}`;

function form(identifier: string, password: string) {
  const data = new FormData();
  data.set("identifier", identifier);
  data.set("password", password);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const error = await run.then(() => null, (e: unknown) => e);
  if (!(error instanceof Redirect)) throw new Error(`expected a redirect, got ${String(error)}`);
  return error.url;
}

beforeEach(() => {
  h.signIn.mockReset().mockResolvedValue("/");
  h.shared = false;
});

describe("loginAction", () => {
  it("个人密码账户：直接回到 callbackUrl", async () => {
    expect(await redirectOf(loginAction("/projects/p1", { message: "" }, form("alice", "own-pass")))).toBe("/projects/p1");
    expect(h.signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({ identifier: "alice", redirect: false }));
  });

  it("共享密码老账户：先到设密码页，原 callbackUrl 跟着走", async () => {
    h.shared = true;
    const url = new URL(await redirectOf(loginAction("/projects/p1", { message: "" }, form("bob", "shared"))), "http://app.test");
    expect(url.pathname).toBe("/settings/password");
    expect(url.searchParams.get("callbackUrl")).toBe("/projects/p1");
  });

  it("CLI 授权页经登录回来：设完个人密码后回到原 CLI 授权地址", async () => {
    h.shared = true;
    const url = new URL(await redirectOf(loginAction(CLI, { message: "" }, form("bob", "shared"))), "http://app.test");
    expect(url.pathname).toBe("/settings/password");
    const callback = url.searchParams.get("callbackUrl");
    expect(callback).toBe(CLI);
    expect(afterPasswordUpdate({ reauthRequired: false }, callback)).toEqual({ continueTo: CLI });
    const reauth = afterPasswordUpdate({ reauthRequired: true }, callback);
    expect(reauth).toEqual({ reauthUrl: `/login?callbackUrl=${encodeURIComponent(CLI)}&reauth=1` });
  });

  it("登录失败：留在登录页给出提示，不跳转", async () => {
    h.signIn.mockRejectedValue(new CredentialsSignin());
    expect(await loginAction("/projects", { message: "" }, form("alice", "wrong"))).toEqual({ message: "账号或密码错误", status: 401 });
  });
});

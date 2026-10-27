/** 登录：个人密码、团队共享密码（仅限非管理员的老账户）、失败锁定。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@prd-lab/core";
import { fakeDb, type FakeDb } from "../../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock("next-auth", () => {
  class AuthError extends Error { type = "AuthError"; }
  class CredentialsSignin extends AuthError { override type = "CredentialsSignin"; code = "credentials"; }
  return { AuthError, CredentialsSignin };
});
vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
}));

import { LOGIN_FAILURE_LIMIT, accountUsesSharedPassword, authenticateCredentials } from "./credentials";
import { LoginLockedError } from "./errors";

const SHARED = "team-shared-pass";

function user(over: Record<string, unknown> = {}) {
  return {
    id: "u1", name: "alice", email: "alice@example.com", role: "editor", passwordHash: null, credentialVersion: 3,
    archivedAt: null, failedLoginCount: 0, loginFailureWindowStartedAt: null, loginLockedUntil: null, ...over,
  };
}

/** 一次登录：锁行查用户 + 一次更新（成功清零或失败计数） */
const login = (row: object | null, password: string) => {
  h.db = fakeDb([row ? [row] : [], undefined]);
  return authenticateCredentials(row ? (row as { name: string }).name : "nobody", password);
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SHARED_PASSWORD", SHARED);
});
afterEach(() => vi.unstubAllEnvs());

describe("authenticateCredentials", () => {
  it("个人密码登录成功，清零失败计数", async () => {
    const row = user({ passwordHash: await hashPassword("personal-1"), failedLoginCount: 2 });
    expect(await login(row, "personal-1")).toEqual({ id: "u1", name: "alice", role: "editor", credentialVersion: 3 });
    expect(h.db.sets()[0]).toMatchObject({ failedLoginCount: 0, loginLockedUntil: null });
  });

  it("设了个人密码的账户不能再用共享密码", async () => {
    expect(await login(user({ passwordHash: await hashPassword("personal-1") }), SHARED)).toBeNull();
  });

  it("没设个人密码的编辑者可用共享密码登录", async () => {
    expect(await login(user(), SHARED)).toMatchObject({ id: "u1", role: "editor" });
  });

  it("没设个人密码的管理员用共享密码登录一律失败，并计入失败次数", async () => {
    expect(await login(user({ role: "admin" }), SHARED)).toBeNull();
    expect(h.db.sets()[0]).toMatchObject({ failedLoginCount: 1 });
  });

  it("管理员用个人密码登录成功", async () => {
    const row = user({ role: "admin", passwordHash: await hashPassword("admin-own-1") });
    expect(await login(row, "admin-own-1")).toMatchObject({ role: "admin" });
  });

  it(`窗口内第 ${LOGIN_FAILURE_LIMIT} 次失败锁定`, async () => {
    const row = user({ failedLoginCount: LOGIN_FAILURE_LIMIT - 1, loginFailureWindowStartedAt: new Date() });
    await expect(login(row, "wrong")).rejects.toBeInstanceOf(LoginLockedError);
    expect(h.db.sets()[0]).toMatchObject({ failedLoginCount: LOGIN_FAILURE_LIMIT });
  });

  it("锁定期内即使密码正确也拒绝", async () => {
    const row = user({ loginLockedUntil: new Date(Date.now() + 60_000) });
    h.db = fakeDb([[row]]);
    await expect(authenticateCredentials("alice", SHARED)).rejects.toBeInstanceOf(LoginLockedError);
  });
});

describe("accountUsesSharedPassword", () => {
  it("没有个人密码 → true；有个人密码或查无此人 → false", async () => {
    h.db = fakeDb([[{ passwordHash: null }], [{ passwordHash: "hash" }], []]);
    expect(await accountUsesSharedPassword("alice")).toBe(true);
    expect(await accountUsesSharedPassword("alice@example.com")).toBe(false);
    expect(await accountUsesSharedPassword("nobody")).toBe(false);
  });
});

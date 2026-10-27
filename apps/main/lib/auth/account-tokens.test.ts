/** 签发 API Token 前在用户行锁内复核请求方凭证：浏览器会话看凭证版本，Bearer 看 token 未撤销。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock("next-auth", () => {
  class AuthError extends Error { type = "AuthError"; }
  class CredentialsSignin extends AuthError { override type = "CredentialsSignin"; }
  return { AuthError, CredentialsSignin };
});
vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
}));
vi.mock("@/lib/api/errors", () => import("../api/errors"));
vi.mock("@/lib/api/pg-errors", () => import("../api/pg-errors"));
vi.mock("@/lib/db/insert-returning", () => import("../db/insert-returning"));

import { createAccountToken } from "./account-tokens";
import { AccountError } from "./account-errors";

const user = { id: "u1", name: "alice", role: "editor", credentialVersion: 4, archivedAt: null, passwordHash: "hash" };
const tokenRow = { id: "t-new", name: "CLI on mac", tokenPrefix: "prd_abc", scopes: null, createdAt: new Date() };

beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret";
  h.db = fakeDb([]);
});

describe("createAccountToken", () => {
  it("浏览器会话的凭证版本已过期（改过密码）→ unauthorized，不建 token", async () => {
    h.db = fakeDb([[user]]);
    await expect(createAccountToken({ userId: "u1", userName: "alice", credentialVersion: 3, isAdmin: false }, "CLI"))
      .rejects.toMatchObject({ code: "unauthorized" });
    expect(h.db.inserts()).toHaveLength(0);
  });

  it("Bearer token 已撤销 → unauthorized，不建 token", async () => {
    h.db = fakeDb([[user], []]);
    const error = await createAccountToken({ userId: "u1", userName: "alice", tokenId: "t-old", isAdmin: false }, "CLI")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountError);
    expect(h.db.inserts()).toHaveLength(0);
  });

  it("账户还在用团队共享密码（没有个人密码）→ personal_password_required，不建 token", async () => {
    h.db = fakeDb([[{ ...user, passwordHash: null }]]);
    await expect(createAccountToken({ userId: "u1", userName: "alice", credentialVersion: 4, isAdmin: false }, "CLI"))
      .rejects.toMatchObject({ code: "personal_password_required" });
    expect(h.db.inserts()).toHaveLength(0);
  });

  it("凭证有效 → 建 token 并返回明文", async () => {
    h.db = fakeDb([[user], undefined, [tokenRow]]);
    const created = await createAccountToken({ userId: "u1", userName: "alice", credentialVersion: 4, isAdmin: false }, "CLI on mac");
    expect(created.plainToken).toMatch(/^prd_/);
    expect(h.db.inserts()[0]).toMatchObject({ userId: "u1", name: "CLI on mac" });
  });
});

/** 注册（开放注册，不要邀请码）、改密与管理员重置都会让旧浏览器会话失效（凭证版本 +1）。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { hashPassword, verifyPassword } from "@prd-lab/core";
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

import { RESET_PASSWORD, changeAccountPassword, registerAccount, resetAccountPassword } from "./accounts";
import { parseRegistration } from "./account-input";

const SHARED = "team-shared-pass";
const sqlText = (value: unknown) =>
  new MySqlDialect().sqlToQuery(value as Parameters<MySqlDialect["sqlToQuery"]>[0]).sql;

function user(over: Record<string, unknown> = {}) {
  return {
    id: "u1", name: "alice", email: "alice@example.com", role: "editor", passwordHash: null, credentialVersion: 3,
    archivedAt: null, createdAt: new Date(), passwordChangedAt: null, ...over,
  };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SHARED_PASSWORD", SHARED);
});
afterEach(() => vi.unstubAllEnvs());

describe("注册", () => {
  const form = { name: "bob", email: "Bob@Example.com", password: "bob-pass-1", confirmPassword: "bob-pass-1" };

  it("生产环境不填邀请码也能注册", async () => {
    expect(parseRegistration(form)).toEqual({ name: "bob", email: "bob@example.com", password: "bob-pass-1" });
    h.db = fakeDb([undefined, [user({ id: "u2", name: "bob", email: "bob@example.com", passwordHash: "x" })]]);
    const { user: created } = await registerAccount(form);
    expect(created).toMatchObject({ name: "bob", role: "editor", passwordMode: "personal" });
    const inserted = h.db.inserts()[0]!;
    expect(inserted).toMatchObject({ name: "bob", email: "bob@example.com", role: "editor" });
    expect(await verifyPassword("bob-pass-1", inserted.passwordHash as string)).toBe(true);
  });
});

describe("改密与重置让旧会话失效", () => {
  it("自己改密：校验当前密码（共享密码老账户填共享密码），凭证版本 +1", async () => {
    h.db = fakeDb([[user()], undefined]);
    await changeAccountPassword(
      { userId: "u1", userName: "alice", credentialVersion: 3, isAdmin: false },
      { currentPassword: SHARED, newPassword: "alice-own-1", confirmPassword: "alice-own-1" },
    );
    const set = h.db.sets()[0]!;
    expect(sqlText(set.credentialVersion)).toBe("`users`.`credential_version` + 1");
    expect(await verifyPassword("alice-own-1", set.passwordHash as string)).toBe(true);
  });

  it("管理员重置：密码固定为 600109，凭证版本 +1", async () => {
    const admin = user({ id: "a1", name: "admin", role: "admin", passwordHash: await hashPassword("admin-own-1") });
    h.db = fakeDb([[admin], [user()], undefined]);
    const result = await resetAccountPassword({ userId: "a1", userName: "admin", credentialVersion: 3, isAdmin: true }, "u1", {});
    expect(result.password).toBe(RESET_PASSWORD);
    expect(RESET_PASSWORD).toBe("600109");
    const set = h.db.sets()[0]!;
    expect(sqlText(set.credentialVersion)).toBe("`users`.`credential_version` + 1");
    expect(await verifyPassword("600109", set.passwordHash as string)).toBe(true);
  });
});

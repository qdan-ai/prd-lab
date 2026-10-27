/** 浏览器会话按凭证版本复核：改密或被重置后，旧会话在下一次复核时失效。 */
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

import { SESSION_VERIFY_TTL_SECONDS, authCallbacks } from "./session";

type JwtArgs = Parameters<typeof authCallbacks.jwt>[0];
const jwt = (token: Record<string, unknown>) => authCallbacks.jwt({ token } as unknown as JwtArgs);
const now = () => Math.floor(Date.now() / 1000);
const current = (credentialVersion: number) => [{ name: "alice", role: "editor", credentialVersion, archivedAt: null }];

beforeEach(() => {
  h.db = fakeDb([]);
});

describe("authCallbacks.jwt", () => {
  it("改密或重置后（数据库凭证版本已变）旧会话复核失败，返回 null", async () => {
    h.db = fakeDb([current(4)]);
    expect(await jwt({ userId: "u1", credentialVersion: 3, verifiedAt: now() - SESSION_VERIFY_TTL_SECONDS })).toBeNull();
  });

  it("凭证版本一致：复核通过并刷新复核时间", async () => {
    h.db = fakeDb([current(3)]);
    const token = await jwt({ userId: "u1", credentialVersion: 3, verifiedAt: now() - SESSION_VERIFY_TTL_SECONDS });
    expect(token).toMatchObject({ userId: "u1", credentialVersion: 3, name: "alice", role: "editor" });
    expect((token as { verifiedAt: number }).verifiedAt).toBeGreaterThanOrEqual(now() - 1);
  });

  it("复核间隔内不查库", async () => {
    const token = await jwt({ userId: "u1", credentialVersion: 3, verifiedAt: now() });
    expect(token).toMatchObject({ userId: "u1" });
    expect(h.db.calls).toHaveLength(0);
  });
});

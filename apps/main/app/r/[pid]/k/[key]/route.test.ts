/**
 * 锁版本链接 /r/<pid>/k/<key>：有访客链接就转访客链接（不看项目 private / team）；
 * 没有访客链接时走账户交接，只有能读项目的账户才拿到预览令牌。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyRepoToken } from "@prd-lab/core";

const h = vi.hoisted(() => ({
  share: null as null | { shareId: string },
  session: null as null | { userId: string },
  readable: false,
  canReadProject: vi.fn(async () => false),
}));

vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  canReadProject: h.canReadProject,
}));
vi.mock("@prd-lab/core/repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findProjectForRepo: async (pid: string) => ({ id: pid, kind: "repo", versionId: "v-sys", ownerId: "owner", visibility: "private", name: "私有项目" }),
  getRepoShare: async () => h.share,
}));
vi.mock("@/lib/api/auth-guard", () => ({ getSession: async () => h.session }));
vi.mock("@/lib/api/errors", () => import("../../../../../lib/api/errors"));
vi.mock("@/lib/auth/errors", () => ({ AuthenticationUnavailableError: class extends Error {} }));
vi.mock("@/lib/api/request-origin", () => import("../../../../../lib/api/request-origin"));
vi.mock("@/lib/repo/route-helpers", () => ({ previewOrigin: () => "http://preview.test" }));

import { GET } from "./route";

const PID = "p-private";
const KEY = "a".repeat(16);
const call = () => GET(new Request(`http://app.test/r/${PID}/k/${KEY}`), { params: Promise.resolve({ pid: PID, key: KEY }) });

beforeEach(() => {
  process.env.HMAC_SECRET = "test-hmac-secret";
  h.share = null;
  h.session = null;
  h.canReadProject.mockReset().mockImplementation(async () => h.readable);
  h.readable = false;
});

describe("/r/<pid>/k/<key>（私有项目）", () => {
  it("有访客链接：匿名也直接转到访客链接，不查账户权限", async () => {
    h.share = { shareId: "share-1" };
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/share/share-1?k=${KEY}`);
    expect(h.canReadProject).not.toHaveBeenCalled();
  });

  it("有访客链接：登录的非成员同样转到访客链接", async () => {
    h.share = { shareId: "share-1" };
    h.session = { userId: "stranger" };
    const res = await call();
    expect(res.headers.get("Location")).toBe(`/share/share-1?k=${KEY}`);
  });

  it("没有访客链接：非创建者、非成员 → 404", async () => {
    h.session = { userId: "stranger" };
    expect((await call()).status).toBe(404);
    expect(h.canReadProject).toHaveBeenCalledWith(PID, "stranger");
  });

  it("没有访客链接：匿名 → 404", async () => {
    expect((await call()).status).toBe(404);
  });

  it("没有访客链接：能读项目的账户拿到账户预览令牌", async () => {
    h.session = { userId: "owner" };
    h.readable = true;
    const res = await call();
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.pathname).toBe(`/r/${PID}`);
    const verified = verifyRepoToken(location.searchParams.get("token")!, PID);
    expect(verified.valid && verified.payload).toMatchObject({ kind: "user", sub: "owner" });
  });
});

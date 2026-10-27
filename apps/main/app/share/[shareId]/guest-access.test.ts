/**
 * 访客链接是访问凭证：项目 private / team 不影响链接下的任何入口。
 * 只有三件事决定能否访问：链接存在且未撤销、密码（若设了）、版本未撤回或归档。
 * 数据库用 fakeDb 顶替，按调用顺序回放查询结果。
 */
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, issueShareCookie, verifyRepoToken, verifyToken } from "@prd-lab/core";
import { fakeDb, type FakeDb } from "../../../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  cookies: new Map<string, string>(),
  getSession: vi.fn(async () => null as unknown),
  repo: {} as Record<string, (...args: never[]) => unknown>,
}));

vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
  getObjectStream: async () => ({ stream: Readable.from([Buffer.from("# spec\n")]), contentLength: 7 }),
}));
vi.mock("@prd-lab/core/repo", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return new Proxy(real, { get: (t, p: string) => h.repo[p] ?? t[p] });
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookies.has(name) ? { name, value: h.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void h.cookies.set(name, value),
  }),
  headers: async () => new Headers(),
}));
// 访客链接不该去查账户身份；一旦被查，就当作匿名
vi.mock("@/lib/api/auth-guard", () => ({ getSession: h.getSession }));
vi.mock("@/lib/share/share-session", () => import("../../../lib/share/share-session"));
vi.mock("@/lib/share/response", () => import("../../../lib/share/response"));
vi.mock("@/lib/share/snapshot-access", () => import("../../../lib/share/snapshot-access"));
vi.mock("@/lib/api/errors", () => import("../../../lib/api/errors"));
vi.mock("@/lib/api/request-origin", () => import("../../../lib/api/request-origin"));
vi.mock("@/lib/preview/sanitize-next", () => import("../../../lib/preview/sanitize-next"));
vi.mock("@/lib/agent/pack", () => import("../../../lib/agent/pack"));
vi.mock("@/lib/agent/respond", () => import("../../../lib/agent/respond"));
vi.mock("@/lib/repo/route-helpers", () => ({ previewOrigin: () => "http://preview.test" }));

import { getShareSession, shareCookieName } from "../../../lib/share/share-session";
import { repoShareEntryUrl } from "../../../lib/repo/share-entry";
import { GET as filesGET } from "./api/files/route";
import { POST as loginPOST } from "./api/login/route";
import { POST as previewTokenPOST } from "./api/preview-token/route";
import { GET as refreshGET } from "./preview-refresh/route";
import { GET as agentGET } from "./agent/v1/[[...rest]]/route";

const SHARE = "share-1";
const VERSION = "version-1";
const REPO = "repo-1";
const SNAPSHOT = "snap-1";
const ORIGIN = "http://app.test";

/** getShareSession 查到的链接行；visibility / projectId 表明所在项目是私有的 */
function shareRow(over: Partial<{ passwordHash: string | null; passwordVersion: number; revokedAt: Date | null }> = {}) {
  return {
    id: SHARE, projectId: REPO, visibility: "private", versionId: VERSION,
    passwordHash: null, passwordVersion: 1, revokedAt: null, ...over,
  };
}

const ctx = (rest?: string[]) => ({ params: Promise.resolve({ shareId: SHARE, ...(rest ? { rest } : {}) }) });
const req = (path: string, init?: RequestInit) => new Request(`${ORIGIN}/share/${SHARE}${path}`, init);

beforeEach(() => {
  process.env.HMAC_SECRET = "test-hmac-secret";
  process.env.AUTH_SECRET = "test-auth-secret";
  process.env.APP_ORIGIN = ORIGIN;
  process.env.NEXT_PUBLIC_PREVIEW_ORIGIN = "http://preview.test";
  h.cookies.clear();
  h.getSession.mockClear();
  h.repo = {};
});

afterEach(() => {
  delete process.env.APP_ORIGIN;
  delete process.env.NEXT_PUBLIC_PREVIEW_ORIGIN;
});

describe("getShareSession：私有项目的访客链接", () => {
  it("无密码：匿名直接放行，不查账户身份", async () => {
    h.db = fakeDb([[shareRow()]]);
    expect(await getShareSession(SHARE)).toEqual({ kind: "ok", shareId: SHARE, versionId: VERSION, pv: 1 });
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it("有密码：凭密码 cookie 放行；没有 cookie、密码版本对不上都不放行", async () => {
    const row = shareRow({ passwordHash: "hash", passwordVersion: 3 });
    h.db = fakeDb([[row], [row], [row]]);
    expect(await getShareSession(SHARE)).toEqual({ kind: "invalid", reason: "no_cookie" });
    h.cookies.set(shareCookieName(SHARE), issueShareCookie({ shareId: SHARE, pv: 2 }, 600));
    expect(await getShareSession(SHARE)).toEqual({ kind: "invalid", reason: "pv_mismatch" });
    h.cookies.set(shareCookieName(SHARE), issueShareCookie({ shareId: SHARE, pv: 3 }, 600));
    expect(await getShareSession(SHARE)).toEqual({ kind: "ok", shareId: SHARE, versionId: VERSION, pv: 3 });
  });

  it("已撤销 → revoked；查不到（含方案或项目已归档）→ not_found", async () => {
    h.db = fakeDb([[shareRow({ revokedAt: new Date() })], []]);
    expect(await getShareSession(SHARE)).toEqual({ kind: "revoked" });
    expect(await getShareSession(SHARE)).toEqual({ kind: "not_found" });
  });
});

describe("访客入口：私有项目无密码链接，匿名访问", () => {
  it("文件列表 200", async () => {
    h.db = fakeDb([[shareRow()], [{ id: SNAPSHOT, entryHtmlPath: "index.html" }], [{ relPath: "index.html" }]]);
    const res = await filesGET(req("/api/files"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [{ relPath: "index.html" }] });
  });

  it("预览令牌签的是访客令牌，不是账户令牌", async () => {
    h.db = fakeDb([[shareRow()], [{ id: SNAPSHOT }]]);
    const res = await previewTokenPOST(
      req("/api/preview-token", { method: "POST", body: JSON.stringify({ snapshotId: SNAPSHOT }) }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const { token } = await res.json();
    const verified = verifyToken(token, SNAPSHOT);
    expect(verified.valid && verified.payload).toMatchObject({ kind: "share", sub: `${SHARE}:1` });
  });

  it("预览站过期回来重签：签访客令牌并弹回预览站", async () => {
    h.db = fakeDb([[shareRow()], [{ id: SNAPSHOT }]]);
    const res = await refreshGET(req(`/preview-refresh?sid=${SNAPSHOT}&next=/p/${SNAPSHOT}/a.html`), ctx());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(`http://preview.test/p/${SNAPSHOT}/a.html`);
    const verified = verifyToken(location.searchParams.get("token")!, SNAPSHOT);
    expect(verified.valid && verified.payload.kind).toBe("share");
  });

  it("仓库项目的分享页入口签仓库级访客令牌", async () => {
    h.repo.repoProjectIdOfVersion = async () => REPO;
    const url = await repoShareEntryUrl({ shareId: SHARE, versionId: VERSION, pv: 1, origin: ORIGIN, v: null, k: null });
    const location = new URL(url!);
    expect(location.pathname).toBe(`/r/${REPO}`);
    const verified = verifyRepoToken(location.searchParams.get("token")!, REPO);
    expect(verified.valid && verified.payload).toMatchObject({ kind: "share", sub: `${SHARE}:1` });
  });
});

describe("访客入口：私有项目有密码链接", () => {
  it("输入密码后拿到 cookie，凭它读文件列表", async () => {
    const passwordHash = await hashPassword("guest-pass");
    const row = shareRow({ passwordHash, passwordVersion: 2 });
    h.db = fakeDb([[row], [{ id: SHARE, passwordHash, passwordVersion: 2, revokedAt: null }]]);
    const login = await loginPOST(
      req("/api/login", { method: "POST", body: JSON.stringify({ password: "guest-pass" }) }),
      ctx(),
    );
    expect(login.status).toBe(200);
    expect(h.cookies.has(shareCookieName(SHARE))).toBe(true);

    h.db = fakeDb([[row], [{ id: SNAPSHOT, entryHtmlPath: "index.html" }], []]);
    const files = await filesGET(req("/api/files"), ctx());
    expect(files.status).toBe(200);
  });

  it("不输密码读文件列表 → 401", async () => {
    h.db = fakeDb([[shareRow({ passwordHash: "hash" })]]);
    expect((await filesGET(req("/api/files"), ctx())).status).toBe(401);
  });
});

describe("AI 读取口（/agent/v1）：私有项目无密码链接，匿名", () => {
  const files = [{ path: "docs/spec.md", size: 7, sha256: "x", contentType: "text/markdown" }];
  const version = {
    key: "k1", kind: "version" as const, number: "1.0", name: null, summary: null, line: "main",
    parentKey: null, patchOf: null, sealedAt: null, specDocs: ["docs/spec.md"], manifest: null, snapshotId: SNAPSHOT,
  };
  beforeEach(() => {
    h.repo = {
      repoProjectIdOfVersion: async () => REPO,
      loadRepoProject: async () => ({ id: REPO, name: "私有项目", ownerId: "owner", visibility: "private", versionId: VERSION }),
      getRepoShare: async () => ({ shareId: SHARE, hasPassword: false, passwordVersion: 1, createdAt: new Date() }),
      lookupAgentVersion: async () => ({ status: "ok", version }),
      listSnapshotFiles: async () => files,
      listSnapshotFileLocations: async () => [{ path: "docs/spec.md", s3Key: "s3/spec" }],
      getRepoView: async () => ({ view: { online: { key: null } } }),
    };
  });

  it("README 200", async () => {
    h.db = fakeDb([[shareRow()]]);
    const res = await agentGET(req("/agent/v1/README.md"), ctx(["README.md"]));
    expect(res.status).toBe(200);
  });

  it("pull 打包下载 200，拿到 zip", async () => {
    h.db = fakeDb([[shareRow()]]);
    const res = await agentGET(req("/agent/v1/k/k1/pull?scope=all"), ctx(["k", "k1", "pull"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 2).toString()).toBe("PK");
  });
});

describe("撤销后返回 410", () => {
  it("文件列表、预览令牌、AI 读取口都是 410", async () => {
    const revoked = shareRow({ revokedAt: new Date() });
    h.db = fakeDb([[revoked], [revoked], [revoked]]);
    expect((await filesGET(req("/api/files"), ctx())).status).toBe(410);
    expect((await previewTokenPOST(
      req("/api/preview-token", { method: "POST", body: JSON.stringify({ snapshotId: SNAPSHOT }) }),
      ctx(),
    )).status).toBe(410);
    const agent = await agentGET(req("/agent/v1/versions"), ctx(["versions"]));
    expect(agent.status).toBe(410);
    expect((await agent.json()).error).toBe("share_revoked");
  });
});

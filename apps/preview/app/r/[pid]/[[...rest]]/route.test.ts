/** /r/<pid>/… 的缓存口径：版本文件按 key 不可变，非 HTML 长期缓存；HTML、文件列表、错误一律 private, no-store。 */
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { issueRepoShareToken, issueRepoToken } from "@prd-lab/core";
import { fakeDb, type FakeDb } from "../../../../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, visibility: "team" as "team" | "private" }));

vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
  getObjectStream: async () => ({ stream: Readable.from([Buffer.from("data")]), contentLength: 4 }),
  canReadProject: async () => false,
}));
vi.mock("@prd-lab/core/repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRepoProject: async (pid: string) => ({ id: pid, name: "项目", ownerId: "owner", visibility: h.visibility, versionId: "v-sys" }),
  lookupRepoKey: async () => ({ status: "ok", snapshotId: "snap-1" }),
  findSnapshotFile: async (_sid: string, path: string) =>
    path === "missing.png" ? null : { s3Key: "k", contentType: path.endsWith(".html") ? "text/html; charset=utf-8" : "image/png" },
  listSnapshotFiles: async () => [],
}));

import { GET } from "./route";

const PID = "repo-1";
const KEY = "a".repeat(16);

function get(rest: string[], token: string) {
  const request = new NextRequest(`http://preview.test/r/${PID}/${rest.join("/")}`, {
    headers: { cookie: `prd-repo-${PID}=${token}` },
  });
  return GET(request, { params: Promise.resolve({ pid: PID, rest }) });
}

const userToken = () => issueRepoToken({ repoId: PID, sessionUserId: "owner" }, 600);

beforeEach(() => {
  process.env.HMAC_SECRET = "test-hmac-secret";
  h.visibility = "team";
  h.db = fakeDb([[{ id: "v-sys" }]]);
});

describe("/r/ 缓存头", () => {
  it("版本里的图片：private, max-age=31536000, immutable", async () => {
    const res = await get(["v", KEY, "img", "a.png"], userToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("版本里的 HTML：private, no-store", async () => {
    const res = await get(["v", KEY, "page.html"], userToken());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("文件列表：private, no-store", async () => {
    const res = await get(["files", KEY], userToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("文件不存在：private, no-store", async () => {
    const res = await get(["v", KEY, "missing.png"], userToken());
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("/r/ 访客令牌", () => {
  it("私有项目的访客令牌照常读到版本文件", async () => {
    h.visibility = "private";
    const token = issueRepoShareToken({ repoId: PID, shareSessionId: "share-1:1" }, 600);
    const res = await get(["v", KEY, "img", "a.png"], token);
    expect(res.status).toBe(200);
  });
});

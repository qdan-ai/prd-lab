/** /p/<sid>/… 的缓存口径：快照内容不可变，非 HTML 子资源长期缓存；HTML、错误一律 private, no-store。 */
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { issueShareToken, issueToken } from "@prd-lab/core";
import { fakeDb, type FakeDb } from "../../../../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));

vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
  getObjectStream: async () => ({ stream: Readable.from([Buffer.from("data")]), contentLength: 4 }),
  canReadProject: async () => false,
}));
vi.mock("@prd-lab/core/renderers", () => ({ RENDERERS: {} }));

import { GET } from "./route";

const SID = "snap-1";
const snapRow = (visibility: "team" | "private") => ({
  id: SID, withdrawn: false, projectId: "p1", visibility, entryHtmlPath: "index.html",
  archivedAt: null, rendererName: null, rendererMetadata: null,
});

function get(rel: string, token: string) {
  const request = new NextRequest(`http://preview.test/p/${SID}/${rel}`, {
    headers: { cookie: `prd-preview-${SID}=${token}` },
  });
  return GET(request, { params: Promise.resolve({ snapshotId: SID, rel: rel.split("/") }) });
}

beforeEach(() => {
  process.env.HMAC_SECRET = "test-hmac-secret";
});

describe("/p/ 缓存头", () => {
  const userToken = () => issueToken({ snapshotId: SID, sessionUserId: "u1" }, 600);

  it("图片等非 HTML 子资源：private, max-age=31536000, immutable", async () => {
    h.db = fakeDb([[snapRow("team")], [{ s3Key: "k", contentType: "image/png" }]]);
    const res = await get("img/a.png", userToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("HTML：private, no-store", async () => {
    h.db = fakeDb([[snapRow("team")], [{ s3Key: "k", contentType: "text/html; charset=utf-8" }]]);
    const res = await get("page.html", userToken());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("错误响应：private, no-store", async () => {
    h.db = fakeDb([[snapRow("team")], []]);
    const res = await get("missing.png", userToken());
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("/p/ 访客令牌", () => {
  it("私有项目的访客令牌照常读到子资源", async () => {
    h.db = fakeDb([[snapRow("private")], [{ s3Key: "k", contentType: "image/png" }]]);
    const token = issueShareToken({ snapshotId: SID, shareSessionId: "share-1:1" }, 600);
    const res = await get("img/a.png", token);
    expect(res.status).toBe(200);
  });
});

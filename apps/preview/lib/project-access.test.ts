import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../packages/core/src/testing/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, canReadProject: vi.fn(async () => false) }));

vi.mock("@prd-lab/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  db: new Proxy({}, { get: (_t, p) => h.db.db[p] }),
  canReadProject: h.canReadProject,
}));

import { privatePreviewDenial, protectedPreviewResponse } from "./project-access";

const privateProject = { id: "p1", visibility: "private" as const };

beforeEach(() => {
  h.db = fakeDb([]);
  h.canReadProject.mockReset().mockResolvedValue(false);
});

describe("privatePreviewDenial", () => {
  it("访客令牌：私有项目也放行，不查账户", async () => {
    expect(await privatePreviewDenial(privateProject, { kind: "share", sub: "share-1:1" }, true)).toBeNull();
    expect(h.canReadProject).not.toHaveBeenCalled();
  });

  it("账户令牌：私有项目对无权账户 404", async () => {
    h.db = fakeDb([[{ id: "stranger" }]]);
    const res = await privatePreviewDenial(privateProject, { kind: "user", sub: "stranger" }, false);
    expect(res?.status).toBe(404);
    expect(h.canReadProject).toHaveBeenCalledWith("p1", "stranger");
  });

  it("账户令牌：能读项目的账户放行", async () => {
    h.db = fakeDb([[{ id: "owner" }]]);
    h.canReadProject.mockResolvedValue(true);
    expect(await privatePreviewDenial(privateProject, { kind: "user", sub: "owner" }, true)).toBeNull();
  });

  it("团队可见项目：一律放行", async () => {
    expect(await privatePreviewDenial({ id: "p1", visibility: "team" }, { kind: "user", sub: "anyone" }, true)).toBeNull();
  });
});

describe("protectedPreviewResponse", () => {
  it("保留响应自己设的缓存头（不可变的版本文件）", async () => {
    const res = await protectedPreviewResponse(async () =>
      new Response("x", { headers: { "Cache-Control": "private, max-age=31536000, immutable" } }));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("没设缓存头的（错误、跳转）补 private, no-store", async () => {
    const res = await protectedPreviewResponse(async () => new Response(null, { status: 302, headers: { Location: "/x" } }));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

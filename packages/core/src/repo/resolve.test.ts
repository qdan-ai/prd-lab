import { describe, expect, it } from "vitest";
import { agentDefaultVersionKey, defaultVersionKey, resolveRepoVersion, type ResolvableVersion, type ResolveInput } from "./resolve";

let order = 0;
function v(key: string, number: string, extra: Partial<ResolvableVersion> = {}): ResolvableVersion {
  order += 1;
  return {
    key,
    kind: "version",
    number,
    line: "main",
    sealedAt: new Date(Date.UTC(2026, 9, order)),
    createdAt: new Date(Date.UTC(2026, 9, order)),
    withdrawn: false,
    ...extra,
  };
}

function input(versions: ResolvableVersion[], extra: Partial<ResolveInput> = {}): ResolveInput {
  return { versions, draft: null, onlineKey: null, ...extra };
}

const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const draft = (key: string, day: number) => ({ key, publishedAt: at(day) });

describe("defaultVersionKey（访客：最新的一版）", () => {
  it("有上线版本、也有更新的封版 → 更新的封版", () => {
    const vs = [v("k1", "v1.0", { sealedAt: at(1), createdAt: at(1) }), v("k2", "v1.1", { sealedAt: at(2), createdAt: at(2) })];
    expect(defaultVersionKey(input(vs, { onlineKey: "k1" }))).toBe("k2");
  });

  it("补丁线封版比主线新 → 补丁线那版", () => {
    const vs = [
      v("k1", "v1.0", { sealedAt: at(1), createdAt: at(1) }),
      v("k2", "v1.1", { sealedAt: at(2), createdAt: at(2) }),
      v("k3", "v1.0-fix1", { line: "fix-v1.0", sealedAt: at(3), createdAt: at(3) }),
    ];
    expect(defaultVersionKey(input(vs))).toBe("k3");
  });

  it("封版时间相同 → 后推上来的", () => {
    const vs = [
      v("k1", "v1.0", { sealedAt: at(1), createdAt: at(2) }),
      v("k2", "v1.1", { sealedAt: at(1), createdAt: at(3) }),
    ];
    expect(defaultVersionKey(input(vs))).toBe("k2");
  });

  it("草稿在最新版本到站之后发布 → 草稿（哪怕有上线版本）", () => {
    const vs = [v("k1", "v1.0", { sealedAt: at(1), createdAt: at(1) }), v("k2", "v1.1", { sealedAt: at(2), createdAt: at(2) })];
    expect(defaultVersionKey(input(vs, { onlineKey: "k1", draft: draft("d1", 3) }))).toBe("d1");
  });

  it("首次推送整段历史：版本与草稿同时到站 → 草稿", () => {
    const vs = [v("k1", "v1.0", { sealedAt: at(1), createdAt: at(5) }), v("k2", "v1.1", { sealedAt: at(2), createdAt: at(5) })];
    expect(defaultVersionKey(input(vs, { draft: draft("d1", 5) }))).toBe("d1");
  });

  it("草稿发布后又到了新版本 → 新版本", () => {
    const vs = [v("k1", "v1.0", { sealedAt: at(1), createdAt: at(1) }), v("k2", "v1.1", { sealedAt: at(4), createdAt: at(4) })];
    expect(defaultVersionKey(input(vs, { draft: draft("d1", 3) }))).toBe("k2");
  });

  it("封版最新的与到站最晚的不是同一版：草稿之后到站的是较老的版本 → 封版最新的那版", () => {
    const vs = [
      v("kA", "v2.0", { sealedAt: at(9), createdAt: at(10) }),
      v("kB", "v1.0-fix1", { line: "fix-v1.0", sealedAt: at(5), createdAt: at(12) }),
    ];
    expect(defaultVersionKey(input(vs, { draft: draft("d1", 11) }))).toBe("kA");
  });

  it("撤回的版本不算：到站时间与候选都不计", () => {
    const vs = [v("k1", "v1.0", { sealedAt: at(1), createdAt: at(1) }), v("k2", "v1.1", { sealedAt: at(4), createdAt: at(4), withdrawn: true })];
    expect(defaultVersionKey(input(vs, { draft: draft("d1", 3) }))).toBe("d1");
    expect(defaultVersionKey(input(vs))).toBe("k1");
  });

  it("只有草稿 → 草稿；什么都没有 → null", () => {
    expect(defaultVersionKey(input([], { draft: draft("d1", 1) }))).toBe("d1");
    expect(defaultVersionKey(input([v("k1", "v1.0", { withdrawn: true })]))).toBeNull();
  });
});

describe("agentDefaultVersionKey（开发 AI：上线版优先）", () => {
  it("有上线版本 → 上线版本（哪怕不是最新、哪怕有更新的草稿）", () => {
    const vs = [v("k1", "v1.0"), v("k2", "v1.1"), v("k3", "v1.2")];
    expect(agentDefaultVersionKey(input(vs, { onlineKey: "k2", draft: draft("d1", 30) }))).toBe("k2");
  });

  it("上线标记指向已撤回的版本 → 当作没有上线版本", () => {
    const vs = [v("k1", "v1.0"), v("k2", "v1.1", { withdrawn: true })];
    expect(agentDefaultVersionKey(input(vs, { onlineKey: "k2" }))).toBe("k1");
  });

  it("无上线 → 主线最新封版，补丁线不算", () => {
    const vs = [v("k1", "v1.0"), v("k2", "v1.1"), v("k3", "v1.0-fix1", { line: "fix-v1.0" })];
    expect(agentDefaultVersionKey(input(vs))).toBe("k2");
  });

  it("主线封版时间相同 → 后推上来的", () => {
    const t = new Date(Date.UTC(2026, 0, 1));
    const vs = [
      v("k1", "v1.0", { sealedAt: t, createdAt: new Date(Date.UTC(2026, 0, 2)) }),
      v("k2", "v1.1", { sealedAt: t, createdAt: new Date(Date.UTC(2026, 0, 3)) }),
    ];
    expect(agentDefaultVersionKey(input(vs))).toBe("k2");
  });

  it("无封版 → 草稿；什么都没有 → null", () => {
    expect(agentDefaultVersionKey(input([], { draft: draft("d1", 1) }))).toBe("d1");
    expect(agentDefaultVersionKey(input([v("k1", "v1.0", { withdrawn: true })]))).toBeNull();
  });
});

describe("resolveRepoVersion", () => {
  const vs = [v("k1", "v1.0"), v("k2", "v1.1"), v("k3", "v1.2", { withdrawn: true }), v("k4", "v1.0-fix1", { line: "p" })];
  const base = input(vs, { onlineKey: "k1", draft: draft("d1", 0) });

  it("不带 v → 默认版本、无提示：访客最新，开发 AI 上线版", () => {
    expect(resolveRepoVersion(base, null)).toEqual({ key: "k4", notice: null });
    expect(resolveRepoVersion(base, "  ")).toEqual({ key: "k4", notice: null });
    expect(resolveRepoVersion(base, null, null, "agent")).toEqual({ key: "k1", notice: null });
  });

  it("按版本号命中，忽略大小写与开头的 v", () => {
    expect(resolveRepoVersion(base, "v1.1").key).toBe("k2");
    expect(resolveRepoVersion(base, "1.1").key).toBe("k2");
    expect(resolveRepoVersion(base, "V1.0-FIX1").key).toBe("k4");
  });

  it("v=draft → 草稿", () => {
    expect(resolveRepoVersion(base, "draft")).toEqual({ key: "d1", notice: null });
  });

  it("号只出现在已撤回的版本上 → 落默认版本，提示 withdrawn", () => {
    expect(resolveRepoVersion(base, "v1.2")).toEqual({
      key: "k4",
      notice: { reason: "withdrawn", requested: "v1.2", openedKey: "k4", openedNumber: "v1.0-fix1", locked: false },
    });
    expect(resolveRepoVersion(base, "v1.2", null, "agent")).toEqual({
      key: "k1",
      notice: { reason: "withdrawn", requested: "v1.2", openedKey: "k1", openedNumber: "v1.0", locked: false },
    });
  });

  it("没有这个号 → 落默认版本，提示 not_found", () => {
    expect(resolveRepoVersion(base, "v9")).toEqual({
      key: "k4",
      notice: { reason: "not_found", requested: "v9", openedKey: "k4", openedNumber: "v1.0-fix1", locked: false },
    });
    expect(resolveRepoVersion(base, "v9", null, "agent")).toEqual({
      key: "k1",
      notice: { reason: "not_found", requested: "v9", openedKey: "k1", openedNumber: "v1.0", locked: false },
    });
  });

  it("撤回后重新封了同号 → 打开新的那一版，不提示", () => {
    const again = input([...vs, v("k5", "v1.2")]);
    expect(resolveRepoVersion(again, "v1.2")).toEqual({ key: "k5", notice: null });
  });

  it("同号多个未撤回 → 封版最新的", () => {
    const dup = input([v("a", "v2"), v("b", "v2")]);
    expect(resolveRepoVersion(dup, "v2").key).toBe("b");
  });
});

describe("resolveRepoVersion · 锁版本链接 k", () => {
  const vs = [
    v("k1aaaaaaaaaa", "v1.0"),
    v("k2bbbbbbbbbb", "v1.1"),
    v("k3cccccccccc", "v1.2", { withdrawn: true }),
  ];
  const base = input(vs, { onlineKey: "k1aaaaaaaaaa", draft: draft("draft-d1", 0) });

  it("key 有效 → 打开它、无提示（哪怕不是默认版本）", () => {
    expect(resolveRepoVersion(base, null, "k2bbbbbbbbbb")).toEqual({ key: "k2bbbbbbbbbb", notice: null });
  });

  it("同时带 v 与 k → 以 k 为准", () => {
    expect(resolveRepoVersion(base, "v1.0", "k2bbbbbbbbbb")).toEqual({ key: "k2bbbbbbbbbb", notice: null });
  });

  it("当前草稿的 key → 打开草稿", () => {
    expect(resolveRepoVersion(base, null, "draft-d1")).toEqual({ key: "draft-d1", notice: null });
  });

  it("已撤回 → 不打开任何版本，锁定提示带 key 前 8 位与默认版本", () => {
    expect(resolveRepoVersion(base, "v1.0", "k3cccccccccc")).toEqual({
      key: null,
      notice: { reason: "withdrawn", requested: "k3cccccc", openedKey: "k2bbbbbbbbbb", openedNumber: "v1.1", locked: true },
    });
    expect(resolveRepoVersion(base, "v1.0", "k3cccccccccc", "agent")).toEqual({
      key: null,
      notice: { reason: "withdrawn", requested: "k3cccccc", openedKey: "k1aaaaaaaaaa", openedNumber: "v1.0", locked: true },
    });
  });

  it("不存在 → 不回落，锁定提示 not_found", () => {
    expect(resolveRepoVersion(base, null, "zzzzzzzzzzzz")).toEqual({
      key: null,
      notice: { reason: "not_found", requested: "zzzzzzzz", openedKey: "k2bbbbbbbbbb", openedNumber: "v1.1", locked: true },
    });
    expect(resolveRepoVersion(base, null, "zzzzzzzzzzzz", "agent")).toEqual({
      key: null,
      notice: { reason: "not_found", requested: "zzzzzzzz", openedKey: "k1aaaaaaaaaa", openedNumber: "v1.0", locked: true },
    });
  });

  it("撤回后又以同号重封（新 key）→ 旧 key 仍判已撤回，不跟到同号新版", () => {
    const again = input([...vs, v("k5eeeeeeeeee", "v1.2")], { onlineKey: "k1aaaaaaaaaa" });
    expect(resolveRepoVersion(again, null, "k3cccccccccc").key).toBeNull();
    expect(resolveRepoVersion(again, null, "k3cccccccccc").notice?.reason).toBe("withdrawn");
  });

  it("k 为空串 → 按 v 解析（不当作锁定）", () => {
    expect(resolveRepoVersion(base, "v1.1", "")).toEqual({ key: "k2bbbbbbbbbb", notice: null });
  });
});

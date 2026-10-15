import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRepoPath, parseSyncManifest, REPO_FORMAT } from "./manifest";
import { blobS3Key, contentDigest, draftKey } from "./digest";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function body(extra: Record<string, unknown> = {}) {
  return { format: REPO_FORMAT, ...extra };
}

describe("parseSyncManifest", () => {
  it("最小清单：空版本、草稿撤下、不改上线标记", () => {
    const r = parseSyncManifest(body());
    expect(r).toEqual({
      ok: true,
      manifest: { versions: [], withdraw: [], online: undefined, draft: null, hidden: [] },
    });
  });

  it("完整版本条目按字段解析，文件表转成路径 + 指纹", () => {
    const r = parseSyncManifest(
      body({
        versions: [
          {
            key: "c1",
            number: "v1.2",
            name: "登录改版",
            summary: "s",
            line: "main",
            parentKey: "c0",
            patchOf: null,
            sealedAt: "2026-10-15T06:30:00.000Z",
            changes: [{ title: "x" }],
            specDocs: ["docs/specs/a.md"],
            files: { "canvas.json": { sha256: SHA_A, size: 3 } },
          },
        ],
        online: { key: "c1", periods: [{ key: "c1", from: "2026-10-15" }] },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.manifest.versions[0]!;
    expect(v.kind).toBe("version");
    expect(v.sealedAt?.toISOString()).toBe("2026-10-15T06:30:00.000Z");
    expect(v.files).toEqual([{ path: "canvas.json", sha256: SHA_A }]);
    expect(r.manifest.online).toEqual({ key: "c1", periods: [{ key: "c1", from: "2026-10-15" }] });
  });

  it("format 不认识 → unsupported_format", () => {
    const r = parseSyncManifest({ format: "gcanvas-repo/2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unsupported_format");
  });

  it("讨论记录路径 → discussions_not_allowed（版本、草稿、起点都拦）", () => {
    const files = { "docs/discussions/2026-10-01.md": { sha256: SHA_A } };
    for (const extra of [
      { versions: [{ key: "c1", files }] },
      { draft: { files } },
      { hidden: [{ key: "h1", files }] },
    ]) {
      const r = parseSyncManifest(body(extra));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("discussions_not_allowed");
        expect(r.error.details).toEqual({ path: "docs/discussions/2026-10-01.md" });
      }
    }
  });

  it("同一个 key 既在 versions 又在 withdraw → 拒", () => {
    const r = parseSyncManifest(body({ versions: [{ key: "c1" }], withdraw: ["c1"] }));
    expect(r.ok).toBe(false);
  });

  it("versions 内重复、起点与版本撞 key → 拒", () => {
    expect(parseSyncManifest(body({ versions: [{ key: "c1" }, { key: "c1" }] })).ok).toBe(false);
    expect(parseSyncManifest(body({ versions: [{ key: "c1" }], hidden: [{ key: "c1" }] })).ok).toBe(false);
  });

  it("key 含 URL 里有歧义的字符 → 拒", () => {
    expect(parseSyncManifest(body({ versions: [{ key: "a/b" }] })).ok).toBe(false);
    expect(parseSyncManifest(body({ withdraw: ["a b"] })).ok).toBe(false);
  });

  it("指纹不是 64 位小写十六进制 → 拒", () => {
    const r = parseSyncManifest(body({ versions: [{ key: "c1", files: { "a.html": { sha256: "ABC" } } }] }));
    expect(r.ok).toBe(false);
  });

  it("草稿须带文件表", () => {
    expect(parseSyncManifest(body({ draft: { line: "main" } })).ok).toBe(false);
  });
});

describe("checkRepoPath", () => {
  it.each(["blocks/a.html", "docs/specs/登录 改版.md", "docs/discussions.md"])("合法：%s", (p) => {
    expect(checkRepoPath(p)).toBeNull();
  });
  // a..b 与 zip / 预览站规则一致按子串拒
  it.each(["", "/abs", "../x", "a..b", "a\\b", "C:/x", "a\nb", "x".repeat(701)])("非法：%j", (p) => {
    expect(checkRepoPath(p)?.code).toBe("validation_error");
  });
});

describe("contentDigest / draftKey", () => {
  it("与文件顺序无关，内容变了指纹就变", () => {
    const d1 = contentDigest([
      { path: "b.html", sha256: SHA_B },
      { path: "a.html", sha256: SHA_A },
    ]);
    const d2 = contentDigest([
      { path: "a.html", sha256: SHA_A },
      { path: "b.html", sha256: SHA_B },
    ]);
    expect(d1).toBe(d2);
    expect(contentDigest([{ path: "a.html", sha256: SHA_B }, { path: "b.html", sha256: SHA_B }])).not.toBe(d1);
  });

  it("按 UTF-8 字节序排列（与码点序一致，不是 UTF-16 序）", () => {
    // U+FF21（全角 A，BMP 高位）在 UTF-16 序里排在 U+1F600（emoji，代理对 0xD83D…）之后，
    // 在码点 / UTF-8 字节序里排在之前
    const a = { path: "\uFF21", sha256: SHA_A };
    const b = { path: "\u{1F600}", sha256: SHA_B };
    const manual = (x: typeof a, y: typeof a) =>
      createHash("sha256").update(`${x.path}\0${x.sha256}\n${y.path}\0${y.sha256}\n`).digest("hex");
    expect(contentDigest([b, a])).toBe(manual(a, b));
  });

  it("草稿 key 同内容同值，换基于的版本就变", () => {
    expect(draftKey("main", "c1", "d")).toBe(draftKey("main", "c1", "d"));
    expect(draftKey("main", "c1", "d")).not.toBe(draftKey("main", "c2", "d"));
    expect(draftKey("main", "c1", "d")).toMatch(/^draft-[0-9a-f]{40}$/);
  });

  it("对象存储键按项目隔离", () => {
    expect(blobS3Key("p1", SHA_A)).toBe(`projects/p1/blobs/${SHA_A}`);
  });
});

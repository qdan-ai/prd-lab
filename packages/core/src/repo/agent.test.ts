import { describe, expect, it } from "vitest";
import {
  AGENT_PACK_MAX_BYTES,
  batchAdvice,
  buildAgentPrompt,
  checkPackBudget,
  fileRoles,
  fillPassword,
  normalizeRequestPath,
  PASSWORD_PLACEHOLDER,
  rawContentType,
  readChangeManifest,
  renderAgentReadme,
  renderPullRecord,
  renderVersionDoc,
  scopeSummaries,
  selectFiles,
  type AgentFile,
} from "./agent";

const f = (path: string, size = 10): AgentFile => ({ path, size, sha256: "a".repeat(64), contentType: "text/html" });

const table: AgentFile[] = [
  f("canvas.json", 5),
  f("blocks/home.html", 100),
  f("blocks/pay.html", 200),
  f("blocks/unrelated.html", 300),
  f("docs/specs/home.md", 50),
  f("docs/knowledge/rules.md", 40),
  f("docs/knowledge/other.md", 30),
  f("assets/logo.png", 1000),
];

const rawManifest = {
  format: "prdlab-change/1",
  version: { key: "k1" },
  requirements: [
    {
      id: "R-1",
      change: "modified",
      title: "首页改版",
      description: "说明",
      items: [
        { item: "page:b1", change: "modified", label: "首页", note: "", paths: ["blocks/home.html"] },
        { item: "page:b9", change: "deleted", label: "旧页", note: "", paths: ["blocks/gone.html"] },
      ],
      specDocs: ["docs/specs/home.md"],
    },
  ],
  unassigned: [{ item: "page:b2", change: "added", label: "支付", note: "", paths: ["blocks/pay.html"] }],
  specs: [{ path: "docs/specs/home.md", digest: "d", requirements: ["R-1"], anchors: [] }],
  truthDocs: [
    { path: "docs/knowledge/rules.md", digest: "d", requirements: ["R-1"] },
    { path: "docs/knowledge/other.md", digest: "d", requirements: ["R-99"] },
  ],
};
const manifest = readChangeManifest(rawManifest);

describe("readChangeManifest", () => {
  it("读出拉取要用的字段", () => {
    expect(manifest?.specs).toEqual(["docs/specs/home.md"]);
    expect(manifest?.requirements[0]?.items).toHaveLength(2);
    expect(manifest?.unassigned[0]?.paths).toEqual(["blocks/pay.html"]);
  });
  it("格式号不对或不是对象 → null", () => {
    expect(readChangeManifest({ ...rawManifest, format: "x" })).toBeNull();
    expect(readChangeManifest(null)).toBeNull();
    expect(readChangeManifest([])).toBeNull();
  });
  it("字段缺失按空处理，不抛", () => {
    const m = readChangeManifest({ format: "prdlab-change/1" });
    expect(m).toEqual({ specs: [], truthDocs: [], requirements: [], unassigned: [] });
  });
});

describe("selectFiles · changes", () => {
  it("spec + 改动涉及 + 关联本版需求的真相文档，其余不选", () => {
    const sel = selectFiles({ files: table, scope: "changes", manifest, specDocs: null });
    expect(sel.selected.map((x) => x.path)).toEqual([
      "blocks/home.html",
      "blocks/pay.html",
      "docs/knowledge/rules.md",
      "docs/specs/home.md",
    ]);
    expect(sel.totalBytes).toBe(100 + 200 + 40 + 50);
    expect(sel.noManifest).toBe(false);
  });

  it("删除项不进结果，只列在 deleted（含所属需求）", () => {
    const sel = selectFiles({ files: table, scope: "changes", manifest, specDocs: null });
    expect(sel.selected.some((x) => x.path === "blocks/gone.html")).toBe(false);
    expect(sel.deleted).toEqual([{ path: "blocks/gone.html", requirement: "R-1", item: "page:b9", label: "旧页" }]);
  });

  it("删除项的路径即使仍在文件表里也不进 changes", () => {
    const withGone = [...table, f("blocks/gone.html", 7)];
    const sel = selectFiles({ files: withGone, scope: "changes", manifest, specDocs: null });
    expect(sel.selected.some((x) => x.path === "blocks/gone.html")).toBe(false);
  });

  it("清单引用了文件表里没有的路径 → 忽略，不报错", () => {
    const sparse = table.filter((x) => x.path !== "blocks/pay.html");
    const sel = selectFiles({ files: sparse, scope: "changes", manifest, specDocs: null });
    expect(sel.selected.some((x) => x.path === "blocks/pay.html")).toBe(false);
  });

  it("旧版本没有机器清单 → 退回版本记录的 specDocs ∩ 文件表，并标 noManifest", () => {
    const sel = selectFiles({
      files: table,
      scope: "changes",
      manifest: null,
      specDocs: ["docs/specs/home.md", "docs/specs/not-in-table.md"],
    });
    expect(sel.selected.map((x) => x.path)).toEqual(["docs/specs/home.md"]);
    expect(sel.noManifest).toBe(true);
  });
});

describe("selectFiles · all / paths", () => {
  it("all 是文件表全部，按路径排序", () => {
    const sel = selectFiles({ files: [...table].reverse(), scope: "all", manifest: null, specDocs: null });
    expect(sel.selected).toHaveLength(table.length);
    expect(sel.selected[0]!.path).toBe("assets/logo.png");
    expect(sel.totalBytes).toBe(table.reduce((n, x) => n + x.size, 0));
  });

  it("paths 支持文件与目录前缀，不在表里的进 notFound", () => {
    const sel = selectFiles({
      files: table,
      scope: "paths",
      paths: ["docs/knowledge/", "blocks/home.html", "blocks/nope.html", "assets"],
      manifest: null,
      specDocs: null,
    });
    expect(sel.selected.map((x) => x.path)).toEqual([
      "assets/logo.png",
      "blocks/home.html",
      "docs/knowledge/other.md",
      "docs/knowledge/rules.md",
    ]);
    expect(sel.notFound).toEqual(["blocks/nope.html"]);
  });

  it("目录前缀按整段匹配：blocks 不会选中 blocks2/", () => {
    const sel = selectFiles({
      files: [...table, f("blocks2/x.html")],
      scope: "paths",
      paths: ["blocks"],
      manifest: null,
      specDocs: null,
    });
    expect(sel.selected.every((x) => x.path.startsWith("blocks/"))).toBe(true);
  });

  it("越界与非法路径一律 notFound，不会选中任何文件", () => {
    const bad = ["../etc/passwd", "/blocks/home.html", "blocks/../canvas.json", "a\\b", "C:/x", "", "  ", ".", "/", "docs/discussions/x.md"];
    const sel = selectFiles({ files: table, scope: "paths", paths: bad, manifest: null, specDocs: null });
    expect(sel.selected).toEqual([]);
    expect(sel.notFound).toEqual(bad);
  });

  it("paths 重复项去重；开头的 ./ 被忽略", () => {
    const sel = selectFiles({
      files: table,
      scope: "paths",
      paths: ["./blocks/home.html", "blocks/home.html", "blocks/"],
      manifest: null,
      specDocs: null,
    });
    expect(sel.selected.map((x) => x.path)).toEqual(["blocks/home.html", "blocks/pay.html", "blocks/unrelated.html"]);
  });
});

describe("normalizeRequestPath", () => {
  it("合法路径原样；越界返回 null", () => {
    expect(normalizeRequestPath("docs/a.md")).toBe("docs/a.md");
    expect(normalizeRequestPath("方案...md")).toBe("方案...md");
    expect(normalizeRequestPath("../a")).toBeNull();
    expect(normalizeRequestPath("a/../b")).toBeNull();
  });
});

describe("fileRoles / scopeSummaries / 预检", () => {
  it("角色优先级 spec > truth > change > other", () => {
    const roles = fileRoles(table, manifest, null);
    expect(roles.get("docs/specs/home.md")).toBe("spec");
    expect(roles.get("docs/knowledge/rules.md")).toBe("truth");
    expect(roles.get("docs/knowledge/other.md")).toBe("other");
    expect(roles.get("blocks/pay.html")).toBe("change");
    expect(roles.get("assets/logo.png")).toBe("other");
  });

  it("两种范围的文件数与体积", () => {
    const s = scopeSummaries(table, manifest, null);
    expect(s.changes).toEqual({ fileCount: 4, bytes: 390, noManifest: false });
    expect(s.all.fileCount).toBe(table.length);
  });

  it("超过上限 → 不通过；等于上限 → 通过", () => {
    expect(checkPackBudget(AGENT_PACK_MAX_BYTES)).toEqual({ ok: true });
    expect(checkPackBudget(AGENT_PACK_MAX_BYTES + 1)).toMatchObject({ ok: false, limit: AGENT_PACK_MAX_BYTES });
  });

  it("分批建议按顶层目录列体积", () => {
    const advice = batchAdvice(table);
    expect(advice).toContain("assets/");
    expect(advice).toContain("paths");
  });
});

describe("rawContentType", () => {
  it("Markdown → text/markdown；位图 → 原类型", () => {
    expect(rawContentType("docs/a.md", "text/markdown")).toBe("text/markdown; charset=utf-8");
    expect(rawContentType("docs/a.md", "application/octet-stream")).toBe("text/markdown; charset=utf-8");
    expect(rawContentType("a.png", "image/png")).toBe("image/png");
  });
  it("HTML / SVG / JS / CSS / JSON 一律 text/plain（不让原型脚本在主站域名下运行）", () => {
    for (const [p, t] of [
      ["a.html", "text/html"],
      ["a.svg", "image/svg+xml"],
      ["a.js", "application/javascript"],
      ["a.js", "text/javascript"],
      ["a.css", "text/css"],
      ["canvas.json", "application/json"],
    ] as const) {
      expect(rawContentType(p, t)).toBe("text/plain; charset=utf-8");
    }
  });
  it("其他二进制 → octet-stream", () => {
    expect(rawContentType("a.woff2", "font/woff2")).toBe("application/octet-stream");
  });
});

const baseDoc = (over: Partial<Parameters<typeof renderVersionDoc>[0]> = {}) => ({
  projectName: "理财首页改版",
  version: { key: "k1", number: "1.3", name: "补充收益说明", summary: null, line: "main", kind: "version", sealedAt: "2026-10-10T00:00:00.000Z", online: true },
  root: "http://h/share/s1/agent/v1",
  pulledAt: new Date(Date.UTC(2026, 9, 20)),
  allFiles: table,
  manifest,
  specDocs: null,
  selection: selectFiles({ files: table, scope: "changes", manifest, specDocs: null }),
  ...over,
});

describe("renderVersionDoc", () => {
  it("写明 key、范围、改动清单、没拉的文件（带体积与补拉命令）", () => {
    const md = renderVersionDoc(baseDoc());
    expect(md).toContain("v1.3「补充收益说明」");
    expect(md).toContain("版本 key：k1");
    expect(md).toContain("### R-1 修改 · 首页改版");
    expect(md).toContain("blocks/home.html");
    expect(md).toContain("- blocks/ 1 个文件，300 B");
    expect(md).toContain('补拉：curl -s -o more.zip "http://h/share/s1/agent/v1/k/k1/pull?paths=');
    expect(md).toContain("assets/");
  });
  it("删除项写进说明但标明不在目录里", () => {
    const md = renderVersionDoc(baseDoc());
    expect(md).toContain("## 本版删除的文件");
    expect(md).toContain("blocks/gone.html（R-1 · 旧页）");
  });
  it("没有机器清单时注明，并仍给出 spec", () => {
    const sel = selectFiles({ files: table, scope: "changes", manifest: null, specDocs: ["docs/specs/home.md"] });
    const md = renderVersionDoc(baseDoc({ manifest: null, specDocs: ["docs/specs/home.md"], selection: sel }));
    expect(md).toContain("本版推送时没有机器清单，只给出 spec 文档");
    expect(md).toContain("docs/specs/home.md");
  });
  it("paths 里未找到的路径列出", () => {
    const sel = selectFiles({ files: table, scope: "paths", paths: ["x/y.md"], manifest, specDocs: null });
    expect(renderVersionDoc(baseDoc({ selection: sel }))).toContain("- x/y.md");
  });
  it("拉全部时没有「没拉的」", () => {
    const sel = selectFiles({ files: table, scope: "all", manifest, specDocs: null });
    expect(renderVersionDoc(baseDoc({ selection: sel }))).toContain("本版文件已全部拉取");
  });
  it("拉取记录 JSON 含文件表与原清单", () => {
    const rec = JSON.parse(renderPullRecord({ ...baseDoc(), changeManifest: rawManifest }));
    expect(rec.format).toBe("prdlab-pull/1");
    expect(rec.files).toHaveLength(4);
    expect(rec.deleted).toEqual(["blocks/gone.html"]);
    expect(rec.changeManifest.format).toBe("prdlab-change/1");
  });
});

const promptIn = {
  projectName: "理财首页改版",
  origin: "http://101.96.194.178",
  shareId: "abc123",
  version: { key: "9f3c2a1b7d04ffff", number: "1.3", name: "补充收益说明" },
  hasPassword: false,
};

describe("buildAgentPrompt", () => {
  it("无密码：只有 plain，withPassword 为 null，不出现密码段", () => {
    const p = buildAgentPrompt(promptIn);
    expect(p.withPassword).toBeNull();
    expect(p.plain).not.toContain("访问密码");
    expect(p.plain).not.toContain(PASSWORD_PLACEHOLDER);
    expect(p.plain).toContain("接口根地址：http://101.96.194.178/share/abc123/agent/v1");
    expect(p.plain).toContain("v1.3「补充收益说明」（key 9f3c2a1b7d04ffff）");
    expect(p.plain).toContain("/k/9f3c2a1b7d04ffff/pull?scope=changes");
    expect(p.plain).toContain("./prd/理财首页改版/v1.3_9f3c2a1b/");
  });
  it("有密码：plain 不含占位符且写明向开发要密码；withPassword 恰好一个占位符、单独成行", () => {
    const p = buildAgentPrompt({ ...promptIn, hasPassword: true });
    expect(p.plain).not.toContain(PASSWORD_PLACEHOLDER);
    expect(p.plain).toContain("向开发要密码");
    expect(p.plain).toContain("/share/abc123/api/login");
    expect(p.withPassword).not.toBeNull();
    expect(p.withPassword!.split(PASSWORD_PLACEHOLDER)).toHaveLength(2);
    expect(p.withPassword!.split("\n")).toContain(PASSWORD_PLACEHOLDER);
  });
  it("未指定版本：不写 key，让 AI 先看版本表", () => {
    const p = buildAgentPrompt({ ...promptIn, version: null });
    expect(p.plain).toContain("本次未指定版本");
    expect(p.plain).toContain("没有上线版用最新");
  });
  it("项目名里的斜杠不会变成路径层级", () => {
    const p = buildAgentPrompt({ ...promptIn, projectName: "a/b\\c" });
    expect(p.plain).toContain("./prd/a_b_c/");
  });
  it("fillPassword 原样填入，$ 与引号不被当成替换模式", () => {
    const p = buildAgentPrompt({ ...promptIn, hasPassword: true });
    const filled = fillPassword(p.withPassword!, `a$&b"c$'d`);
    expect(filled).toContain(`\na$&b"c$'d\n`);
    expect(filled).not.toContain(PASSWORD_PLACEHOLDER);
  });
  it("README 复用同一模板并带接口一览", () => {
    const md = renderAgentReadme({ projectName: "P", origin: "http://h", shareId: "s", hasPassword: false });
    expect(md).toContain("# PRD-Lab 版本拉取说明");
    expect(md).toContain("/k/<key>/pull");
    expect(md).toContain("413");
  });
});

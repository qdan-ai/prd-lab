import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ZipFile } from "@prd-lab/core/zip-utils";
import { parseAndValidateZip } from "@prd-lab/core/zip-utils";
import { computeMetadata, validateFiles } from "./index";

/**
 * html-canvas renderer Node 侧单测。
 *
 * 两层覆盖：
 *   1. mock ZipFile 验证 validateFiles / computeMetadata 的逻辑分支（含对抗用例）
 *   2. 真实 demo-board.zip 走 parseAndValidateZip 完整链路，确认现网格式不"水土不服"
 *
 * 关键防线：validateFiles 必须显式拒绝无 format 字段的 zip（pm-canvas 格式），
 * 避免新旧格式误判（P0-1 修复）。
 */

/** 构造 mock ZipFile，只关心 relPath + buffer，其余字段填占位值。 */
function mockFile(relPath: string, content: string): ZipFile {
  const buffer = Buffer.from(content, "utf-8");
  return {
    relPath,
    contentType: "application/octet-stream",
    sizeBytes: buffer.byteLength,
    sha256: "0".repeat(64),
    buffer,
  };
}

describe("validateFiles", () => {
  it("接受合法 board/v1 格式", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "board/v1", elements: [] }))];
    expect(validateFiles(files)).toBeNull();
  });

  it("接受合法 board/v2 格式", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "board/v2", objects: [], elements: [] }))];
    expect(validateFiles(files)).toBeNull();
  });

  it("board/v2 同样要求 elements 数组", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "board/v2", objects: [] }))];
    expect(validateFiles(files)).toContain("elements array");
  });

  it("拒绝未知的 board 版本（board/v3）", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "board/v3", elements: [] }))];
    expect(validateFiles(files)).toContain('format must be "board/v1"');
  });

  it("拒绝缺 canvas.json 的 zip", () => {
    const files = [mockFile("blocks/welcome.html", "<div>hi</div>")];
    const err = validateFiles(files);
    expect(err).toContain("requires canvas.json");
  });

  it("拒绝 canvas.json 不是合法 JSON", () => {
    const files = [mockFile("canvas.json", "{ not valid json")];
    const err = validateFiles(files);
    expect(err).toContain("not valid JSON");
  });

  // 【P0-1 修复】核心防线：无 format 字段 = pm-canvas 格式，必须拒绝
  it("拒绝无 format 字段的 zip（pm-canvas 格式）", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ elements: [] }))];
    const err = validateFiles(files);
    expect(err).toContain('missing "format" field');
  });

  it("拒绝 format !== board/v1 的 zip", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "legacy", elements: [] }))];
    const err = validateFiles(files);
    expect(err).toContain('format must be "board/v1"');
  });

  it("拒绝缺 elements 数组的 zip", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "board/v1" }))];
    const err = validateFiles(files);
    expect(err).toContain("elements array");
  });

  // 【P1-1 对抗用例】混合格式：有 blocks/ 但 format 错误，仍应被 format 检查拦下
  it("拒绝错误 format 即便携带 blocks/（混合格式攻击）", () => {
    const files = [
      mockFile("canvas.json", JSON.stringify({ format: "legacy", elements: [] })),
      mockFile("blocks/test.html", "<div>test</div>"),
    ];
    const err = validateFiles(files);
    expect(err).toContain('format must be "board/v1"');
  });

  // 【P1-1 对抗用例】format 为空字符串：falsy，应被无 format 分支拦下
  it("拒绝 format 为空字符串", () => {
    const files = [mockFile("canvas.json", JSON.stringify({ format: "", elements: [] }))];
    const err = validateFiles(files);
    expect(err).toContain('missing "format" field');
  });
});

describe("computeMetadata", () => {
  it("正确统计 elementCount", () => {
    const files = [
      mockFile(
        "canvas.json",
        JSON.stringify({ format: "board/v1", elements: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
      ),
    ];
    expect(computeMetadata(files).elementCount).toBe(3);
  });

  it("canvas.json 不合法时 elementCount 回落 0", () => {
    const files = [mockFile("canvas.json", "{ broken")];
    expect(computeMetadata(files).elementCount).toBe(0);
  });

  it("正确提取并排序 docs 列表（md / excalidraw / drawio）", () => {
    const files = [
      mockFile("canvas.json", JSON.stringify({ format: "board/v1", elements: [] })),
      mockFile("docs/spec.md", "# spec"),
      mockFile("docs/flow.excalidraw", "{}"),
      mockFile("docs/arch.drawio", "<xml/>"),
    ];
    const meta = computeMetadata(files);
    expect(meta.docs).toEqual([
      { path: "docs/arch.drawio", type: "drawio" },
      { path: "docs/flow.excalidraw", type: "excalidraw" },
      { path: "docs/spec.md", type: "md" },
    ]);
  });

  it("跳过 docs/ 下嵌套子目录与无关后缀", () => {
    const files = [
      mockFile("canvas.json", JSON.stringify({ format: "board/v1", elements: [] })),
      mockFile("docs/sub/nested.md", "# nested"),
      mockFile("docs/readme.txt", "plain"),
      mockFile("docs/note.md", "# note"),
    ];
    const meta = computeMetadata(files);
    expect(meta.docs).toEqual([{ path: "docs/note.md", type: "md" }]);
  });

  it("正确判定 hasBlocks / hasStyles", () => {
    const withBoth = [
      mockFile("canvas.json", JSON.stringify({ format: "board/v1", elements: [] })),
      mockFile("blocks/a.html", "<div/>"),
      mockFile("styles/tokens.css", ":root{}"),
    ];
    expect(computeMetadata(withBoth)).toMatchObject({ hasBlocks: true, hasStyles: true });

    const withNeither = [
      mockFile("canvas.json", JSON.stringify({ format: "board/v1", elements: [] })),
    ];
    expect(computeMetadata(withNeither)).toMatchObject({ hasBlocks: false, hasStyles: false });
  });
});

describe("gcanvas-v2-board 夹具", () => {
  const dir = resolve(__dirname, "../fixtures/gcanvas-v2-board");
  const load = (rel: string) => mockFile(rel, readFileSync(resolve(dir, rel), "utf-8"));

  it("validateFiles 通过，computeMetadata 统计到元素与 blocks", () => {
    const files = [load("canvas.json"), load("blocks/login.html"), load("blocks/terms.html")];
    expect(validateFiles(files)).toBeNull();
    expect(computeMetadata(files)).toMatchObject({ hasBlocks: true, elementCount: 3 });
  });
});

// fixture 受版本控制，确保干净 clone 也能跑测试
const FIXTURES_DIR = resolve(__dirname, "../fixtures");

describe("demo-board.zip 真实 zip 集成", () => {
  it("parseAndValidateZip → validateFiles 通过 + computeMetadata 产出真实元数据", async () => {
    const buffer = readFileSync(resolve(FIXTURES_DIR, "demo-board.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const files = parsed.result.files;
    // stripSingleTopLevelDir 剥掉 demo-board/ 前缀后 canvas.json 落在根
    expect(files.some((f) => f.relPath === "canvas.json")).toBe(true);

    expect(validateFiles(files)).toBeNull();

    const meta = computeMetadata(files);
    expect(meta.hasBlocks).toBe(true);
    expect(meta.hasStyles).toBe(true);
    expect(meta.elementCount).toBeGreaterThan(0);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndValidateZip } from "./index";
import { RENDERERS } from "../renderers/registry";

/**
 * 真实 fixture 集成测试：sprint artifacts 下的两个 zip 走完整解析链路。
 *
 * 价值：单元测试用 mock ZipFile 验证逻辑分支；这里用真实 canvas-v2-demo zip
 * 跑 parseAndValidateZip → RENDERERS["pm-canvas"].validateFiles / computeMetadata，
 * 确认现网格式的 zip 不会在任一环节"水土不服"。
 *
 * 上传通道 renderer 声明不在本测试范围（upload-renderer-selector sprint 起，
 * 声明渠道为 multipart form 字段，由 apps/main 上传 route 集成测试覆盖）；
 * 这里只验证 renderer 包对文件的判断逻辑。
 */

// fixture 受版本控制，确保干净 clone 也能跑测试（renderer-codex-followup sprint P0 修复）
const ZIPS_DIR = resolve(__dirname, "../__fixtures__/zips");

describe("canvas-v2-demo 真实 zip 集成", () => {
  it("canvas-default.zip → 标准 zip 结构（index.html + canvas.json，无 prd-renderer.json）", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-default.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.files.some((f) => f.relPath === "index.html")).toBe(true);
    expect(parsed.result.files.some((f) => f.relPath === "canvas.json")).toBe(true);
    expect(parsed.result.files.some((f) => f.relPath === "prd-renderer.json")).toBe(false);
  });

  it("canvas-pm.zip → pm-canvas validateFiles 通过，computeMetadata 产出真实 docs/anchors", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-pm.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const files = parsed.result.files;
    expect(files.some((f) => f.relPath === "index.html")).toBe(true);
    expect(files.some((f) => f.relPath === "canvas.json")).toBe(true);

    expect(RENDERERS["pm-canvas"]!.validateFiles(files)).toBeNull();

    const computed = RENDERERS["pm-canvas"]!.computeMetadata(files);
    expect(computed).toEqual({
      docs: [
        { path: "docs/requirements.md", type: "md" },
        { path: "docs/测试.drawio", type: "drawio" },
        { path: "docs/测试.md", type: "md" },
        { path: "docs/用户签约流程.excalidraw", type: "excalidraw" },
      ],
      hasAnchors: true,
    });
  });

  it("canvas-pm.zip 内含 prd-renderer.json 不影响 renderer 包逻辑（D15 防回归）", async () => {
    // upload-renderer-selector sprint 起，prd-renderer.json 被当普通文件原样存储，
    // 不再被解析、不参与 renderer 判定。renderer 包对该文件应完全无感知。
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-pm.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const files = parsed.result.files;
    expect(files.some((f) => f.relPath === "prd-renderer.json")).toBe(true);
    // validateFiles / computeMetadata 都不读 prd-renderer.json
    expect(RENDERERS["pm-canvas"]!.validateFiles(files)).toBeNull();
    expect(RENDERERS["pm-canvas"]!.computeMetadata(files).docs).not.toContainEqual(
      expect.objectContaining({ path: "prd-renderer.json" }),
    );
  });

  it("canvas-pm.zip 真实 docs 文件没有触发 nested 校验（docs/ 仅一层）", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-pm.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validateFiles = RENDERERS["pm-canvas"]!.validateFiles(parsed.result.files);
    expect(validateFiles).toBeNull();
  });

  it("canvas-pm.zip 内 .drawio / .excalidraw content-type 已正确推断 (renderer-codex-followup Step 7)", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-pm.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const drawio = parsed.result.files.find((f) => f.relPath.endsWith(".drawio"));
    const excalidraw = parsed.result.files.find((f) => f.relPath.endsWith(".excalidraw"));
    expect(drawio?.contentType).toBe("application/xml; charset=utf-8");
    expect(excalidraw?.contentType).toBe("application/json; charset=utf-8");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndValidateZip } from "./index";
import { parseRendererManifest } from "./manifest";
import { RENDERERS } from "../renderers/registry";

/**
 * 真实 fixture 集成测试：sprint artifacts 下的两个 zip 走完整解析链路。
 *
 * 价值：单元测试用 mock ZipFile 验证逻辑分支；这里用真实 canvas-v2-demo zip
 * 跑 parseAndValidateZip → parseRendererManifest → RENDERERS["pm-canvas"].computeMetadata，
 * 确认现网格式的 zip 不会在任一环节"水土不服"。
 */

const ZIPS_DIR = resolve(
  __dirname,
  "../../../../ai/sprints/active/preview-renderer-adapter/artifacts/zips",
);

describe("canvas-v2-demo 真实 zip 集成", () => {
  it("canvas-default.zip（无 manifest）→ manifest=null，等价 default", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-default.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.files.some((f) => f.relPath === "index.html")).toBe(true);
    expect(parsed.result.files.some((f) => f.relPath === "canvas.json")).toBe(true);
    expect(parsed.result.files.some((f) => f.relPath === "prd-renderer.json")).toBe(false);

    const manifestResult = parseRendererManifest(parsed.result.files);
    expect(manifestResult).toEqual({ ok: true, manifest: null });
  });

  it("canvas-pm.zip（含 pm-canvas manifest）→ manifest.renderer=pm-canvas，validateFiles 通过", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-pm.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const files = parsed.result.files;
    expect(files.some((f) => f.relPath === "prd-renderer.json")).toBe(true);
    expect(files.some((f) => f.relPath === "index.html")).toBe(true);
    expect(files.some((f) => f.relPath === "canvas.json")).toBe(true);

    const manifestResult = parseRendererManifest(files);
    expect(manifestResult.ok).toBe(true);
    if (!manifestResult.ok) return;
    expect(manifestResult.manifest).toEqual({
      schemaVersion: 1,
      renderer: "pm-canvas",
      rendererOptions: null,
    });

    // Step 5.3 接线 @prd-lab/renderer-pm-canvas/node 后 computeMetadata 产出真实数据
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

  it("canvas-pm.zip 真实 docs 文件没有触发 nested 校验（docs/ 仅一层）", async () => {
    const buffer = readFileSync(resolve(ZIPS_DIR, "canvas-pm.zip"));
    const parsed = await parseAndValidateZip(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const validateFiles = RENDERERS["pm-canvas"]!.validateFiles(parsed.result.files);
    expect(validateFiles).toBeNull();
  });
});

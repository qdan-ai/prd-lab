import { describe, expect, it } from "vitest";
import { parseRendererManifest } from "./manifest";
import type { ZipFile } from "./index";

/**
 * 覆盖 DESIGN §15.1 "解析层"全部 checklist。
 *
 * 注意：parseRendererManifest 只依赖 ZipFile.relPath + buffer，其他字段（contentType / sizeBytes / sha256）
 * 在解析层用不到，用占位值满足类型即可。
 */

function file(relPath: string, content?: string): ZipFile {
  const buffer = Buffer.from(content ?? "", "utf-8");
  return {
    relPath,
    contentType: "application/octet-stream",
    sizeBytes: buffer.byteLength,
    sha256: "0".repeat(64),
    buffer,
  };
}

function manifestFile(json: unknown): ZipFile {
  return file("prd-renderer.json", JSON.stringify(json));
}

function pmCanvasBaseFiles(): ZipFile[] {
  return [file("index.html", "<html></html>"), file("canvas.json", "{}")];
}

describe("parseRendererManifest", () => {
  describe("manifest 缺失", () => {
    it("无 prd-renderer.json → manifest=null（等价 default）", () => {
      const r = parseRendererManifest([file("index.html"), file("canvas.json")]);
      expect(r).toEqual({ ok: true, manifest: null });
    });
  });

  describe("renderer=default 等价 manifest 缺失", () => {
    it("schemaVersion=1 + renderer=default → manifest=null", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "default" }),
        file("index.html"),
      ]);
      expect(r).toEqual({ ok: true, manifest: null });
    });
  });

  describe("pm-canvas happy path", () => {
    it("schemaVersion=1 + renderer=pm-canvas + 满足 validateFiles → manifest 含 renderer 名", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "pm-canvas" }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.manifest).toEqual({
          schemaVersion: 1,
          renderer: "pm-canvas",
          rendererOptions: null,
        });
      }
    });

    it("rendererOptions 显式对象透传", () => {
      const r = parseRendererManifest([
        manifestFile({
          schemaVersion: 1,
          renderer: "pm-canvas",
          rendererOptions: { entry: "index.html" },
        }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(true);
      if (r.ok && r.manifest) {
        expect(r.manifest.rendererOptions).toEqual({ entry: "index.html" });
      }
    });
  });

  describe("400 错误码", () => {
    it("manifest 非法 JSON → manifest_invalid_json", () => {
      const r = parseRendererManifest([file("prd-renderer.json", "not json{")]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("manifest_invalid_json");
    });

    it("manifest 根非对象（数组）→ manifest_invalid_json", () => {
      const r = parseRendererManifest([file("prd-renderer.json", "[]")]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("manifest_invalid_json");
    });

    it("schemaVersion ≠ 1 → manifest_unsupported_schema", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 2, renderer: "pm-canvas" }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("manifest_unsupported_schema");
        if (r.error.code === "manifest_unsupported_schema") {
          expect(r.error.version).toBe(2);
        }
      }
    });

    it("schemaVersion 缺失 → manifest_unsupported_schema", () => {
      const r = parseRendererManifest([
        manifestFile({ renderer: "pm-canvas" }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("manifest_unsupported_schema");
    });

    it("renderer 名未知 → manifest_unknown_renderer + supported 列表含 pm-canvas", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "nonexistent-renderer" }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.code === "manifest_unknown_renderer") {
        expect(r.error.name).toBe("nonexistent-renderer");
        expect(r.error.supported).toContain("pm-canvas");
      }
    });

    it("renderer 非字符串 → manifest_unknown_renderer", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: 42 }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("manifest_unknown_renderer");
    });

    it("pm-canvas 缺 canvas.json → manifest_renderer_requirements_unmet", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "pm-canvas" }),
        file("index.html"),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.code === "manifest_renderer_requirements_unmet") {
        expect(r.error.renderer).toBe("pm-canvas");
        expect(r.error.reason).toMatch(/canvas\.json/);
      }
    });

    it("pm-canvas 缺 index.html → manifest_renderer_requirements_unmet", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "pm-canvas" }),
        file("canvas.json", "{}"),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.code === "manifest_renderer_requirements_unmet") {
        expect(r.error.reason).toMatch(/index\.html/);
      }
    });

    it("docs/ 嵌套子目录 → manifest_renderer_requirements_unmet", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "pm-canvas" }),
        ...pmCanvasBaseFiles(),
        file("docs/sub/nested.md", "# nested"),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.code === "manifest_renderer_requirements_unmet") {
        expect(r.error.reason).toMatch(/nested/);
      }
    });

    it("options 含保留键 __computed → manifest_invalid_options", () => {
      const r = parseRendererManifest([
        manifestFile({
          schemaVersion: 1,
          renderer: "pm-canvas",
          rendererOptions: { __computed: { docs: [] } },
        }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.code === "manifest_invalid_options") {
        expect(r.error.renderer).toBe("pm-canvas");
        expect(r.error.reason).toMatch(/__computed/);
      }
    });

    it("rendererOptions 非对象（字符串）→ manifest_invalid_options", () => {
      const r = parseRendererManifest([
        manifestFile({ schemaVersion: 1, renderer: "pm-canvas", rendererOptions: "oops" }),
        ...pmCanvasBaseFiles(),
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("manifest_invalid_options");
    });
  });
});

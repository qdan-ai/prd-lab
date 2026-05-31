import type { ZipFile } from "./index";
import { RENDERERS, listSupportedRenderers } from "../renderers/registry";

/**
 * `prd-renderer.json` 解析（DESIGN §3 + §5.1）。
 *
 * 设计要点：
 *   - manifest 缺失 = default renderer，行为完全等同当前预览站（决策 D2，不嗅探）
 *   - `renderer: "default"` 与 manifest 缺失等价（落库 renderer_name = NULL）
 *   - manifest 存在则做严格 schema/renderer/options/file 四层校验，任一不满足返 400 错误码
 *   - 错误码与 DESIGN §3.3 表一一对应
 */

export type RendererManifest = {
  schemaVersion: 1;
  renderer: string;
  rendererOptions: Record<string, unknown> | null;
};

export type ParseManifestError =
  | { code: "manifest_invalid_json"; message: string }
  | { code: "manifest_unsupported_schema"; version: unknown }
  | { code: "manifest_unknown_renderer"; name: unknown; supported: string[] }
  | { code: "manifest_invalid_options"; renderer: string; reason: string }
  | { code: "manifest_renderer_requirements_unmet"; renderer: string; reason: string };

export type ParseManifestResult =
  | { ok: true; manifest: RendererManifest | null }
  | { ok: false; error: ParseManifestError };

const MANIFEST_FILENAME = "prd-renderer.json";

/** manifest 文件大小硬上限：64KB（renderer-codex-followup Step 7 / codex P2#4）。
 *  防止恶意 manifest 占爆内存进 JSON.parse 与 DB JSON 列。 */
const MANIFEST_MAX_BYTES = 64 * 1024;
/** rendererOptions 序列化大小硬上限：16KB。 */
const RENDERER_OPTIONS_MAX_BYTES = 16 * 1024;

export function parseRendererManifest(files: ZipFile[]): ParseManifestResult {
  const manifestFile = files.find((f) => f.relPath === MANIFEST_FILENAME);
  if (!manifestFile) return { ok: true, manifest: null };

  // size guard：在 JSON.parse 前拦截，避免恶意 manifest 触发解析层 OOM 或下游 DB 列爆掉
  if (manifestFile.buffer.byteLength > MANIFEST_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: "manifest_invalid_json",
        message: `manifest file exceeds ${MANIFEST_MAX_BYTES} bytes limit`,
      },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(manifestFile.buffer.toString("utf-8"));
  } catch (e) {
    return {
      ok: false,
      error: { code: "manifest_invalid_json", message: (e as Error).message },
    };
  }

  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {
      ok: false,
      error: { code: "manifest_invalid_json", message: "manifest root must be a JSON object" },
    };
  }

  const root = json as Record<string, unknown>;

  if (root.schemaVersion !== 1) {
    return {
      ok: false,
      error: { code: "manifest_unsupported_schema", version: root.schemaVersion },
    };
  }

  const renderer = root.renderer;
  if (typeof renderer !== "string" || renderer.length === 0) {
    return {
      ok: false,
      error: {
        code: "manifest_unknown_renderer",
        name: renderer,
        supported: listSupportedRenderers(),
      },
    };
  }

  // "default" 等价于 manifest 缺失（DESIGN §3.3 / §5.2）
  if (renderer === "default") {
    return { ok: true, manifest: null };
  }

  const spec = RENDERERS[renderer];
  if (!spec) {
    return {
      ok: false,
      error: {
        code: "manifest_unknown_renderer",
        name: renderer,
        supported: listSupportedRenderers(),
      },
    };
  }

  // rendererOptions 可缺、可 null，可对象；非法类型直接判 invalid_options
  let rendererOptions: Record<string, unknown> | null = null;
  if (root.rendererOptions !== undefined && root.rendererOptions !== null) {
    if (typeof root.rendererOptions !== "object" || Array.isArray(root.rendererOptions)) {
      return {
        ok: false,
        error: {
          code: "manifest_invalid_options",
          renderer,
          reason: "rendererOptions must be an object",
        },
      };
    }
    rendererOptions = root.rendererOptions as Record<string, unknown>;
    // size guard：rendererOptions 序列化后 > 16KB → 拒。
    // 防止 PM 把图片 base64 / 大段文本塞进 manifest（应放 zip 内文件）。
    const serialized = JSON.stringify(rendererOptions);
    if (serialized.length > RENDERER_OPTIONS_MAX_BYTES) {
      return {
        ok: false,
        error: {
          code: "manifest_invalid_options",
          renderer,
          reason: `rendererOptions exceeds ${RENDERER_OPTIONS_MAX_BYTES} bytes limit`,
        },
      };
    }
  }

  const optionsErr = spec.validateOptions(rendererOptions);
  if (optionsErr !== null) {
    return {
      ok: false,
      error: { code: "manifest_invalid_options", renderer, reason: optionsErr },
    };
  }

  const filesErr = spec.validateFiles(files);
  if (filesErr !== null) {
    return {
      ok: false,
      error: { code: "manifest_renderer_requirements_unmet", renderer, reason: filesErr },
    };
  }

  return {
    ok: true,
    manifest: { schemaVersion: 1, renderer, rendererOptions },
  };
}

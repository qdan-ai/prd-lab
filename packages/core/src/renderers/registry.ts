import type { ZipFile } from "../zip-utils";
import {
  computeMetadata as pmCanvasComputeMetadata,
  validateFiles as pmCanvasValidateFiles,
  validateOptions as pmCanvasValidateOptions,
} from "@prd-lab/renderer-pm-canvas/node";

/**
 * Renderer 注册表（v1 硬编码）。
 *
 * 设计原则（DESIGN §3.4 / 决策 D3）：prd-lab 主体不懂任何具体 renderer 格式，
 * 所有格式知识封装在 renderer 包；注册表仅持有函数引用。
 *
 *   - `computeMetadata` / `validateFiles` / `validateOptions` 全部来自 renderer 包，
 *     core 不感知文件布局、docs 后缀映射、必需文件清单等格式细节
 *     （renderer-codex-followup sprint Step 3 补齐 validateFiles / validateOptions 搬迁）
 *
 * 不可变性约束（决策 D12）：注册表条目应视为只增不删；下线 renderer 走 fallback。
 */
export type RendererComputedMetadata = Record<string, unknown>;

export type RendererSpec = {
  /** 必须与 manifest.renderer 字符串匹配（小写连字符） */
  name: string;
  /** manifest schema 期望的版本，SPA 据此做兼容（写入 renderer_metadata.schemaVersion） */
  configVersion: number;
  description: string;
  /** 校验 zip 内文件是否满足 renderer 必需结构；不满足返 string 错误信息 */
  validateFiles: (files: ZipFile[]) => null | string;
  /** 校验 manifest.rendererOptions 用户字段；不满足返 string 错误信息（含 `__computed` 保留键拦截） */
  validateOptions: (options: unknown) => null | string;
  /** 上传时由 renderer 包计算的元数据；并入 renderer_metadata.__computed */
  computeMetadata: (files: ZipFile[]) => RendererComputedMetadata;
  /** SPA 静态资源 mount path；prd-lab 注入 SPA HTML 时用作 ./ 前缀（DESIGN §6.2） */
  staticMountPath: string;
  /** SPA 入口 HTML 在 renderer 包内的相对路径 */
  spaEntryHtml: string;
};

/** rendererOptions 保留键：prd-lab 在 INSERT 时自动注入 __computed 命名空间，不允许 PM 手填 */
export const RESERVED_OPTION_KEYS = ["__computed"] as const;

export const RENDERERS: Record<string, RendererSpec> = {
  "pm-canvas": {
    name: "pm-canvas",
    configVersion: 1,
    description: "PM Canvas 画板（含 docs + anchors 只读浏览）",
    validateFiles: pmCanvasValidateFiles,
    validateOptions: pmCanvasValidateOptions,
    computeMetadata: pmCanvasComputeMetadata,
    staticMountPath: "/renderers/pm-canvas/static",
    spaEntryHtml: "dist/index.html",
  },
};

/** 已注册的 renderer 名列表（manifest 校验失败时返回给 PM） */
export function listSupportedRenderers(): string[] {
  return Object.keys(RENDERERS);
}

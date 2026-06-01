/**
 * SPA 与 prd-lab 预览站之间的 config 契约（DESIGN §7.3.1）。
 *
 * 注入方式：预览站 SPA shell HTML 内 inline <script> 设置
 *   window.__PRD_LAB_RENDERER_CONFIG__ = { ... }
 * SPA 在 main.tsx 启动时读取本对象，校验 schemaVersion 后挂载 React 树。
 *
 * 不向下破坏；新增字段必须可选；schema 升级走 schemaVersion 整体 bump（D11/D9）。
 */

import type { PmCanvasComputedMetadata } from "../node";

export type RendererConfig = {
  /** 与 RENDERERS["pm-canvas"].configVersion 一致；不匹配时 SPA 拒绝挂载并显示错误 */
  schemaVersion: number;
  /** 当前 snapshot ID，仅用于 UI 展示与 fetch 路径拼接；不含鉴权信息 */
  snapshotId: string;
  /** 子资源 fetch 前缀，预览站注入时填 `/p/{snapshotId}/`，结尾带斜杠 */
  dataBaseUrl: string;
  /** 画板入口 HTML 在 snapshot 内的相对路径（如 `index.html`），由预览站从 snapshots.entryHtmlPath 拷贝 */
  entryHtmlPath: string;
  /** snapshots.renderer_metadata 整体；schemaVersion + 上传 route 注入的 __computed */
  rendererMetadata: PmCanvasRendererMetadata;
};

export type PmCanvasRendererMetadata = {
  schemaVersion: number;
  __computed: PmCanvasComputedMetadata;
};

declare global {
  interface Window {
    __PRD_LAB_RENDERER_CONFIG__?: RendererConfig;
  }
}

export type AnchorPin = {
  id?: string;
  rowId?: string;
  docPath?: string;
  /** 锚点在画板上的位置（百分比 0-1）；本 sprint 仅展示在 docs 端 chip，不做 overlay 跟随（D10）*/
  x?: number;
  y?: number;
  label?: string;
};

/**
 * anchors.json schema 对齐 pm-canvas-viewer 实现（examples/canvas-v2-demo/docs/anchors.json）：
 *   { version: 1, anchors: [...] }
 * 数组里每条字段宽松（viewer 未集中定义；以 rowId / label 为 v1 必有），其他字段防御性可选。
 */
export type AnchorsFile = {
  version: number;
  anchors: AnchorPin[];
};

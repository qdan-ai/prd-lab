/**
 * SPA 与 prd-lab 预览站之间的 config 契约。
 *
 * 注入方式：预览站 SPA shell HTML 内 inline <script> 设置
 *   window.__PRD_LAB_RENDERER_CONFIG__ = { ... }
 * SPA 在 main.tsx 启动时读取本对象，校验 schemaVersion 后挂载 React 树。
 *
 * 与 pm-canvas 的 RendererConfig 契约保持一致（预览站注入逻辑共用）。
 */

import type { HtmlCanvasComputedMetadata } from "../node";
import type { CanvasDoc, CanvasElement } from "./schema";

export type RendererConfig = {
  /** 与 RENDERERS["html-canvas"].configVersion 一致；不匹配时 SPA 拒绝挂载并显示错误 */
  schemaVersion: number;
  /** 当前 snapshot ID，仅用于 UI 展示与 fetch 路径拼接；不含鉴权信息 */
  snapshotId: string;
  /** 子资源 fetch 前缀，预览站注入时填 `/p/{snapshotId}/`，结尾带斜杠 */
  dataBaseUrl: string;
  /** 画板入口 HTML 在 snapshot 内的相对路径（如 `index.html`），由预览站从 snapshots.entryHtmlPath 拷贝 */
  entryHtmlPath: string;
  /** snapshots.renderer_metadata 整体；schemaVersion + 上传 route 注入的 __computed */
  rendererMetadata: HtmlCanvasRendererMetadata;
};

export type HtmlCanvasRendererMetadata = {
  schemaVersion: number;
  __computed: HtmlCanvasComputedMetadata;
};

/** docs 面板的单条文档（与 node 侧 __computed.docs 元素同形） */
export type DocItem = {
  path: string;
  type: "md" | "excalidraw" | "drawio";
};

/** 画板数据 = canvas.json 解析结果 */
export type BoardData = CanvasDoc;

/** 重导出 schema 类型，便于 SPA 内部统一从 types 引入 */
export type { CanvasElement };

declare global {
  interface Window {
    __PRD_LAB_RENDERER_CONFIG__?: RendererConfig;
  }
}

// 走 core 的细粒度 zip-utils export 而非根 "."；避免 tsc 跨包跟进 core/renderers/registry.ts
// （registry.ts 反向 import 本包 → 触发"先有鸡还是先有蛋"的编译循环）
import type { ZipFile } from "@prd-lab/core/zip-utils";

/**
 * html-canvas renderer Node 入口。
 *
 * 由 prd-lab 上传 route 在解析完 zip 后调用，产出的对象写入
 * snapshots.renderer_metadata.__computed。SPA 启动时通过 window.__PRD_LAB_RENDERER_CONFIG__
 * 拿到本对象，据此渲染 docs 面板。
 *
 * 设计约束：
 *   - prd-lab 主体不懂 html_canvas 格式，所有格式识别知识封装在本函数
 *   - 函数纯粹无副作用，可在 Node / 测试环境直接调用
 *   - 输出字段稳定，schema 不向下破坏
 */

export type HtmlCanvasComputedMetadata = {
  docs: Array<{ path: string; type: "md" | "excalidraw" | "drawio" }>;
  hasBlocks: boolean;
  hasStyles: boolean;
  elementCount: number; // 从 canvas.json 读取的元素数量
};

const DOCS_PREFIX = "docs/";
const ACCEPTED_FORMATS: readonly unknown[] = ["board/v1", "board/v2"];

/**
 * 校验 zip 是否为合法的 html_canvas board/v1 或 board/v2 格式。
 *
 * 必需文件：
 *   - canvas.json（根目录）
 *   - canvas.json.format 为 "board/v1" 或 "board/v2"（区分新旧格式的关键）
 *
 * 与 pm-canvas 的区别：
 *   - pm-canvas 没有 format 字段，块文件在根目录
 *   - html_canvas 的块文件在 blocks/ 子目录
 *
 * board/v2 在 v1 上增加顶层 objects 与 html 元素的分类字段；
 * 此处只做格式闸门，两版共用同一组结构检查，对象与分类字段的细则由画板应用写入时保证。
 */
export function validateFiles(files: ZipFile[]): null | string {
  const canvasFile = files.find((f) => f.relPath === "canvas.json");

  if (!canvasFile) {
    return "renderer html-canvas requires canvas.json at zip root";
  }

  // 解析 canvas.json 检查格式版本
  let canvasData: any;
  try {
    canvasData = JSON.parse(canvasFile.buffer.toString("utf-8"));
  } catch (e) {
    return "canvas.json is not valid JSON";
  }

  // 【P0-1 修复】关键区分点：显式拒绝无 format 字段（pm-canvas 格式）
  if (!canvasData.format) {
    return 'canvas.json missing "format" field (not a html_canvas board)';
  }
  if (!ACCEPTED_FORMATS.includes(canvasData.format)) {
    return `canvas.json format must be "board/v1" or "board/v2", got "${canvasData.format}"`;
  }

  // 基础结构校验
  if (!Array.isArray(canvasData.elements)) {
    return "canvas.json must have elements array";
  }

  return null;
}

/**
 * 计算元数据，写入 renderer_metadata.__computed。
 *
 * SPA 启动时通过 window.__PRD_LAB_RENDERER_CONFIG__ 拿到本对象。
 */
export function computeMetadata(files: ZipFile[]): HtmlCanvasComputedMetadata {
  // 提取 docs/ 下的文档
  const docs: Array<{ path: string; type: "md" | "excalidraw" | "drawio" }> = [];

  for (const f of files) {
    if (!f.relPath.startsWith(DOCS_PREFIX)) continue;
    const rest = f.relPath.slice(DOCS_PREFIX.length);

    // 跳过嵌套子目录
    if (rest.includes("/")) continue;

    if (rest.endsWith(".md")) {
      docs.push({ path: f.relPath, type: "md" });
    } else if (rest.endsWith(".excalidraw")) {
      docs.push({ path: f.relPath, type: "excalidraw" });
    } else if (rest.endsWith(".drawio")) {
      docs.push({ path: f.relPath, type: "drawio" });
    }
  }

  docs.sort((a, b) => a.path.localeCompare(b.path));

  // 统计块和样式
  const hasBlocks = files.some((f) => f.relPath.startsWith("blocks/"));
  const hasStyles = files.some((f) => f.relPath.startsWith("styles/"));

  // 读取元素数量
  const canvasFile = files.find((f) => f.relPath === "canvas.json");
  let elementCount = 0;
  if (canvasFile) {
    try {
      const data = JSON.parse(canvasFile.buffer.toString("utf-8"));
      elementCount = data.elements?.length ?? 0;
    } catch {}
  }

  return { docs, hasBlocks, hasStyles, elementCount };
}

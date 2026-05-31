// 走 core 的细粒度 zip-utils export 而非根 "."；避免 tsc 跨包跟进 core/renderers/registry.ts
// （registry.ts 反向 import 本包 → 触发"先有鸡还是先有蛋"的编译循环）
import type { ZipFile } from "@prd-lab/core/zip-utils";

/**
 * pm-canvas renderer Node 入口（DESIGN §7.3.3 / 决策 D3）。
 *
 * 由 prd-lab 上传 route 在解析完 zip 后调用，产出的对象写入
 * snapshots.renderer_metadata.__computed。SPA 启动时通过 window.__PRD_LAB_RENDERER_CONFIG__
 * 拿到本对象，据此渲染 docs 面板。
 *
 * 设计约束：
 *   - prd-lab 主体不懂 pm-canvas 格式，所有"什么文件算 doc / anchors flag 怎么算"的知识
 *     封装在本函数（D3）
 *   - 函数纯粹无副作用，可在 Node / 测试环境直接调用
 *   - 输出字段稳定，schema 不向下破坏；新增字段走 schemaVersion 升级（D11）
 */

export type PmCanvasDoc = {
  path: string;
  type: "md" | "excalidraw" | "drawio";
};

export type PmCanvasComputedMetadata = {
  docs: PmCanvasDoc[];
  hasAnchors: boolean;
};

const DOCS_PREFIX = "docs/";
const ANCHORS_PATH = "docs/anchors.json";

// rendererOptions 保留键（与 core registry.RESERVED_OPTION_KEYS 同步），
// 让 validateOptions 校验闭环在 renderer 包内。
const RESERVED_OPTION_KEYS = ["__computed"] as const;

export function computeMetadata(files: ZipFile[]): PmCanvasComputedMetadata {
  const docs: PmCanvasDoc[] = [];
  let hasAnchors = false;

  for (const f of files) {
    if (f.relPath === ANCHORS_PATH) {
      hasAnchors = true;
      continue;
    }
    if (!f.relPath.startsWith(DOCS_PREFIX)) continue;
    const rest = f.relPath.slice(DOCS_PREFIX.length);
    // validateFiles 已拒绝嵌套子目录；防御性二次拦截
    if (rest.includes("/")) continue;
    if (rest.endsWith(".md")) {
      docs.push({ path: f.relPath, type: "md" });
    } else if (rest.endsWith(".excalidraw")) {
      docs.push({ path: f.relPath, type: "excalidraw" });
    } else if (rest.endsWith(".drawio")) {
      docs.push({ path: f.relPath, type: "drawio" });
    }
    // 其他 docs/ 下文件（如 .png 附件）忽略，SPA 不展示
  }

  // 稳定排序，便于 SPA UI 列表展示与测试断言
  docs.sort((a, b) => a.path.localeCompare(b.path));

  return { docs, hasAnchors };
}

/**
 * 校验上传 zip 是否满足 pm-canvas 必需结构（DESIGN §3.4 / 决策 D3）：
 *   - 根目录必须有 index.html 与 canvas.json
 *   - docs/ 下禁止嵌套子目录（与 viewer 行为一致）
 *
 * 从 core registry 搬到 renderer 包，使 prd-lab 主体完全不感知 pm-canvas 文件布局
 * （renderer-codex-followup sprint Step 3）。
 */
export function validateFiles(files: ZipFile[]): null | string {
  if (!files.some((f) => f.relPath === "index.html"))
    return "renderer pm-canvas requires index.html at zip root";
  if (!files.some((f) => f.relPath === "canvas.json"))
    return "renderer pm-canvas requires canvas.json at zip root";
  const nestedDocs = files.find(
    (f) => f.relPath.startsWith(DOCS_PREFIX) && f.relPath.slice(DOCS_PREFIX.length).includes("/"),
  );
  if (nestedDocs) return `renderer pm-canvas does not allow nested docs path: ${nestedDocs.relPath}`;
  return null;
}

/**
 * 校验 manifest.rendererOptions 用户字段（DESIGN §3.4）：
 *   - null/undefined 直接通过
 *   - 必须是对象（不是数组）
 *   - 禁止 RESERVED_OPTION_KEYS 中的保留键（如 `__computed`，prd-lab INSERT 时注入）
 *
 * pm-canvas 当前没有自定义选项，只跑公共保留键校验。
 */
export function validateOptions(options: unknown): null | string {
  if (options === null || options === undefined) return null;
  if (typeof options !== "object") return "rendererOptions must be an object";
  for (const key of RESERVED_OPTION_KEYS) {
    if (key in (options as Record<string, unknown>)) {
      return `rendererOptions key "${key}" is reserved`;
    }
  }
  return null;
}

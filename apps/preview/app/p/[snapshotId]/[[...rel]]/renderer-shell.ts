import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { RendererSpec } from "@prd-lab/core";

/**
 * Renderer SPA shell HTML 渲染（DESIGN §6.2 / 决策 D8）。
 *
 * 流程：
 *   1. 从 renderer 包内读 dist/index.html 模板（Vite 用 base:'./'，引用形如 ./assets/...）
 *   2. 重写资源引用前缀：./assets/x → ${spec.staticMountPath}/assets/x
 *   3. inline 注入 `window.__PRD_LAB_RENDERER_CONFIG__`
 *
 * 性能：
 *   - 模板按 spec.name 进程级缓存（一次磁盘读 + 一次前缀重写，命中后只剩字符串拼接）
 *   - dev 模式如需热重载：手动重启 next（或后续加 NODE_ENV !== production 时禁用缓存）
 *
 * 安全：
 *   - JSON.stringify 后把 `<` 替换为 `<` 避免提前结束 inline script
 *   - HTML 注入位置固定在 </head>，与 SPA HTML 结构强耦合；模板格式变更需同步本文件
 */

const require = createRequire(import.meta.url);

type CachedTemplate = {
  // HTML 模板（前缀已重写、未含 inline config）；请求时拼 inline script 即可
  html: string;
};

const templateCache = new Map<string, CachedTemplate>();

export type RendererInjectedConfig = {
  schemaVersion: number;
  snapshotId: string;
  dataBaseUrl: string;
  entryHtmlPath: string;
  rendererMetadata: unknown;
};

export async function renderRendererSpaShell(args: {
  spec: RendererSpec;
  snapshotId: string;
  entryHtmlPath: string;
  rendererMetadata: unknown;
}): Promise<string> {
  const { spec, snapshotId, entryHtmlPath, rendererMetadata } = args;

  const template = await loadTemplate(spec);

  const config: RendererInjectedConfig = {
    schemaVersion: spec.configVersion,
    snapshotId,
    dataBaseUrl: `/p/${snapshotId}/`,
    entryHtmlPath,
    rendererMetadata,
  };

  const inlineScript = `<script>window.__PRD_LAB_RENDERER_CONFIG__ = ${jsonForInline(config)};</script>`;

  return template.html.replace(/<\/head>/i, `${inlineScript}</head>`);
}

async function loadTemplate(spec: RendererSpec): Promise<CachedTemplate> {
  const cached = templateCache.get(spec.name);
  if (cached) return cached;

  const pkgDir = resolveRendererPkgDir(spec.name);
  const htmlPath = join(pkgDir, spec.spaEntryHtml);

  let html: string;
  try {
    html = await readFile(htmlPath, "utf-8");
  } catch (e) {
    throw new Error(
      `renderer-shell: failed to read SPA HTML at ${htmlPath} (renderer ${spec.name}). Ensure 'pnpm --filter @prd-lab/renderer-${spec.name} build' has been run. cause: ${(e as Error).message}`,
    );
  }

  // 重写资源前缀。Vite base:'./' 产出形如：
  //   <script type="module" crossorigin src="./assets/index-XXX.js"></script>
  //   <link rel="stylesheet" crossorigin href="./assets/index-XXX.css">
  //   <link rel="modulepreload" crossorigin href="./assets/chunk-XXX.js">
  // 统一把 src="./" / href="./" 替换为 src="{mount}/" / href="{mount}/"
  const mount = spec.staticMountPath;
  const rewritten = html.replace(/(\s(?:src|href)=["'])\.\//g, `$1${mount}/`);

  const entry: CachedTemplate = { html: rewritten };
  templateCache.set(spec.name, entry);
  return entry;
}

function jsonForInline(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * 定位 renderer 包目录（dev/prod 双模式兼容）。
 *
 * - `next start`（生产）：`require.resolve` 返回真实文件系统路径
 * - `next dev`（Turbopack）：`require.resolve` 返回 `[project]/...` 占位 URL，
 *   `fs.readFile` 拿到该路径会 ENOENT。
 *
 * 策略：先信任 require.resolve；若结果不是真实路径（不存在），fallback 到
 * `process.cwd()/node_modules/@prd-lab/renderer-{name}`（apps/preview 启动时 cwd
 * 即 apps/preview，其 node_modules 通过 pnpm symlink 指向真实包目录）。
 */
function resolveRendererPkgDir(name: string): string {
  try {
    const pkgPath = require.resolve(`@prd-lab/renderer-${name}/package.json`);
    const dir = dirname(pkgPath);
    if (existsSync(dir)) return dir;
  } catch {
    // 落到 fallback
  }
  return resolve(process.cwd(), "node_modules", `@prd-lab/renderer-${name}`);
}

/**
 * 单元测试 / 部署期诊断用：清空模板缓存。生产路径不调用。
 */
export function __clearTemplateCacheForTest(): void {
  templateCache.clear();
}

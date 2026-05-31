# @prd-lab/renderer-pm-canvas

PRD-Lab 预览站的 PM Canvas 画板只读 renderer。

## 入口

- `./node` — Node 端 `computeMetadata(files)`，prd-lab 上传 route 调用以提取 docs 清单与 anchors flag
- `./dist/*` — SPA 静态资源（Vite 构建产物），prd-lab 预览站通过 `/_renderers/pm-canvas/static/*` 暴露

## 构建

```bash
pnpm install
pnpm --filter @prd-lab/renderer-pm-canvas build
```

产出：
- `dist/index.html` + `dist/assets/*`（SPA bundle）
- `node/index.js` + `node/index.d.ts`（Node 入口）

## 设计约束（来自 sprint preview-renderer-adapter DESIGN v2 + D22）

- 在线**只读**，无任何编辑/写盘能力
- 与左侧画板 iframe **同 origin**，通过 `iframe.contentDocument` 直接读写（不用 postMessage）
- `addEventListener('message', ...)` 必须校验 `event.origin === location.origin` 且 `event.source` 匹配预期 iframe
- drawio viewer 走 `viewer.diagrams.net` lightbox + URL `#hash`（D22）；XML 不上行 jgraph，访问元数据外送已知接受；CSP `frame-src` 仅放行 `https://viewer.diagrams.net`
- SPA 不把画板 DOM 内容当 trusted HTML 注入到 SPA 自身（XSS 防御）
- 生产关闭 sourcemap（D19）
- `dist/` 不进 git（D5），部署期 Docker build 阶段产出

## Node 入口契约

```ts
import { computeMetadata } from "@prd-lab/renderer-pm-canvas/node";
import type { ZipFile } from "@prd-lab/core";

const result = computeMetadata(files); // files: ZipFile[]
// → { docs: Array<{path, type}>, hasAnchors: boolean }
```

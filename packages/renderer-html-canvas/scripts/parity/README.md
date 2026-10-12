# 两边对照工具（G-canvas vs PRD-Lab 查看器）

在 G-canvas 与 PRD-Lab 查看器里分别打开同一份画板，导出每个元素的世界坐标几何与关键渲染属性，比对差异并截图。同步上游后用它确认两边显示一致。

两边画布区域大小、首屏缩放不同，所以比对用**世界坐标**（屏幕坐标减去 `.hc-world` 的原点、再除以缩放），不比像素。

## 文件

| 文件 | 作用 |
|---|---|
| `extract.mjs` | 打开页面，等 HTML 块/图片渲染与布局稳定，导出 JSON；可截图 |
| `compare.mjs` | 比对两份 JSON，输出 markdown 报告，有差异退出码 1 |
| `start-gcanvas.ts` | 以开发态启动 G-canvas 上游并注册画板（`extract --gcanvas` 内部使用） |
| `side-by-side.mjs` | 把两侧同名截图拼成左右对照图：`node side-by-side.mjs --left <目录> --right <目录> --out <目录> --ids board,a3,...` |

依赖：仓库根目录的 `@playwright/test`（需已装 chromium）；G-canvas 一侧另需上游 `viewer/node_modules`。

## 验收画板

- `fixtures/gcanvas-parity-board/`：被 G-canvas 打开过（带 measured）的版本，贴近用户真实分享出的画板。
- `fixtures/gcanvas-parity-board-raw/`：从未打开过（无 measured）的版本，用来测查看器缺 measured 时的表现。

元素与覆盖的难点见 `gcanvas-parity-board/docs/验收说明.md` 与元素清单（`ai/scratch/gcanvas-viewer-sync/parity-notes.md`）。

## 跑 G-canvas 一侧

```bash
cd packages/renderer-html-canvas/scripts/parity
node extract.mjs \
  --gcanvas ../../fixtures/gcanvas-parity-board \
  --out /path/to/out/gcanvas.json \
  --shots /path/to/out/gcanvas-shots
```

- 画板目录会先复制到系统临时目录再交给上游（上游打开后会写回 measured，原目录不受影响）；结束时自动停掉自己起的上游进程并清理副本。
- `--save-canvas <路径>` 把上游写回 measured 后的 `canvas.json` 存出来（更新 `gcanvas-parity-board` 时用）。
- 上游仓库取 `--gcanvas-repo` > 环境变量 `GCANVAS_REPO` > 与 prd-lab 同级的 `../html_canvas`（与 `scripts/gcanvas-sync.mjs` 同一口径）；找不到时报错退出。
- 上游需要 `viewer/dist/` 已构建（本工具只读上游，不构建、不改动上游任何文件）。

## 跑 PRD-Lab 查看器一侧

先起查看器开发服务：

```bash
pnpm --filter @prd-lab/renderer-html-canvas dev
```

再导出（`--expect` 填画板元素总数，等元素全部挂载后再采集）：

```bash
node extract.mjs \
  --url 'http://localhost:5173/dev.html?board=gcanvas-parity-board' \
  --expect 19 \
  --out /path/to/out/prdlab.json \
  --shots /path/to/out/prdlab-shots
```

线上分享链接同样可用：`--url <分享页地址>`。

## 比对

```bash
node compare.mjs /path/to/out/gcanvas.json /path/to/out/prdlab.json --out /path/to/out/report.md
```

- 第一个参数是基准（G-canvas），第二个是对照（PRD-Lab）。
- `--tol`（默认 1）：几何容差，单位世界像素，作用于位置、尺寸、箭头路径坐标。
- `--style-tol`（默认 0.1）：字号、线宽、行高等其它 px 数值的容差。
- `--ignore <正则>`：忽略匹配的字段路径，可重复；路径形如 `t2.text.html`。
- 退出码：0 零差异；1 有差异；2 用法错误。

## 怎么读报告

报告按元素分节，每节一张表：字段路径、G-canvas 值、PRD-Lab 值、说明。

- `box.*`：元素在世界坐标系下的包围盒（`x/y/w/h`）。箭头的盒是 SVG 渲染盒（含外扩），文本/HTML 块是 wrapper 盒。
- `arrow.d`：可见路径，已换算到世界坐标；说明里会指出第几个记号命令不同或坐标超差。路径段数不同通常是走线模式不同（直线 / 直角折线 / 曲线）。
- `arrow.markerStart/markerEnd`：端头形状（三角实心 / 开口 V）与颜色；`null` 表示无端头。
- `arrow.stroke / strokeWidth / dasharray / linecap`：线色、线宽、线型（虚线 / 点线）。
- `arrow.label`：标签文本与中心的世界坐标。
- `text.html`：渲染后的 Markdown HTML（忽略标签间空白）；`text.fontSize / fontFamily / color / textAlign / lineHeight / textDecorationLine / width`：整框外观；`text.inline.*`：加粗、斜体、删除线、高亮、列表等标签的计算样式。
- `frame.title`、`shape.text / clipPath`、`image.file / natural / size`、`html.hostBox / imgs / text`：对应元素类型的专属字段。`html.text` 含注入的样式文本，样式没带全会在这里体现。
- `(元素)` 行：某一侧缺元素。`(图层顺序)`：元素 DOM 顺序不同，遮挡关系会不一致。

整板截图 `board.png` 与每个元素特写 `el-<id>.png` 两侧同名，可并排目视对照。特写用的相机是"元素放得下、居中、缩放不超过 1"，两侧一致。

## 采集约定（改 DOM 时需保持）

舞台 `.hc-stage`，世界容器 `.hc-world`（`transform = translate(tx,ty) scale(zoom)`）；非箭头元素 `.hc-el[data-hc-id][data-hc-type]`；箭头 `.hc-arrow[data-hc-id][data-hc-type=arrow]`（内含 svg，可见路径是 svg 下最后一个非透明 `path`，标签 `.hc-arrow-label`）；文本 `.hc-text`；frame 标题 `.hc-frame-title`；形状 `.hc-shape` / `.hc-shape-text`；HTML 块 `.hc-html-host`（Shadow DOM）；图片 `img`。选择器对不上时 `extract` 会等到超时并报元素数。

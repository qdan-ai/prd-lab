# @prd-lab/renderer-html-canvas

PRD-Lab 预览站的 html-canvas 只读查看器：渲染 G-canvas（html_canvas 仓库）画板目录（`canvas.json` + `blocks/` + `styles/` + `assets/` + `docs/`）。

- `node/`：上传时的格式识别与元数据计算（`validateFiles` / `computeMetadata`），校验保持宽松
- `src/`：查看器 SPA，`dist/` 由 Vite 构建、预览站挂载
- `src/gcanvas/`：从 G-canvas 复制的引擎与渲染组件（下文「与 G-canvas 同步」）

以下命令都在 **prd-lab 仓库根目录**执行。

## 本地开发

```bash
pnpm --filter @prd-lab/renderer-html-canvas dev
# 打开 http://localhost:5173/dev.html?board=<fixtures 下的目录名>
```

`dev.html` 只在 dev server 存在，不进生产 `dist/`。dev server 把 `fixtures/<目录名>/` 原样挂在 `/__fixtures/<目录名>/`，按预览站同样的形状注入 `window.__PRD_LAB_RENDERER_CONFIG__`（`__computed` 由 `node/` 的 `computeMetadata` 算出）。5173 被占用时 Vite 自动顺延端口，路径与参数不变。

```bash
pnpm --filter @prd-lab/renderer-html-canvas typecheck
pnpm --filter @prd-lab/renderer-html-canvas exec vitest run
pnpm --filter @prd-lab/renderer-html-canvas build
```

## 与 G-canvas 同步

查看器画布部分与 G-canvas 用同一份代码：上游 `viewer/src/` 下渲染需要的文件按原相对路径放在 `src/gcanvas/`，清单 `gcanvas-sync.json` 记录上游 commit 与逐文件哈希。文件分三类：

| 类型 | 含义 | 谁来改 |
|---|---|---|
| `verbatim` 逐字件 | 与上游字节相同 | 只由 `sync` 写入，禁止手改；确需改动就转为 `adapted` 并在清单 `note` 写理由 |
| `adapted` 改写件 | 对照上游某文件改写的 PRD-Lab 代码（如只读版 `ElementLayer.tsx`、作用域收进 `.hc-stage` 的 `base.css`） | 人工对照上游 diff 后改 |
| `shim` 垫片 | 放在上游相对路径上、顶替编辑器依赖的 PRD-Lab 代码（`canvas-context.ts`、`editor-kernel/index.ts`） | 人工对照上游接口变化后改 |

清单字段：`upstream.commit` 是逐字件同步到的 commit；改写件与垫片各自的 `reconciledCommit` / `upstreamSha256` 是已人工对照到的上游版本，只在 `--accept` 时推进；`watch` 记录上游若干目录（渲染器、渲染相关引擎、编辑内核、样式、字体）的已知文件集合，上游新增或删除文件时报红；`deps` 指向上游 `package.json`，check 会以「提示」列出逐字件引用的 npm 包在上游与本包的声明版本差异（不报红）。

命令（上游仓库位置：`--repo` > 环境变量 `GCANVAS_REPO` > 与 prd-lab 同级的 `../html_canvas`；只读上游已提交内容，不读工作区、不写上游）：

```bash
pnpm --filter @prd-lab/renderer-html-canvas gcanvas:check                    # 与上游 HEAD 比对；有漂移非零退出，逐条说明怎么处理
pnpm --filter @prd-lab/renderer-html-canvas gcanvas:check -- --commit <rev>  # 与指定 commit 比对
pnpm --filter @prd-lab/renderer-html-canvas gcanvas:sync                     # 逐字件覆盖写入；改写件 / 垫片 / 监视目录只报告
pnpm --filter @prd-lab/renderer-html-canvas gcanvas:sync -- --accept         # 人工对照完改写件、垫片与新文件后，记入清单
```

也可直接 `node packages/renderer-html-canvas/scripts/gcanvas-sync.mjs <check|sync> …`（不依赖当前目录）。本机找不到上游仓库时 `check` 打印「跳过」并以 0 退出（构建服务器上没有上游仓库）；清单写坏时报出哪一项不对并以 2 退出。

`scripts/deploy.sh` 在发布前跑一次 check：有漂移即终止部署；确认本次发布与画板查看器无关时加 `--allow-gcanvas-drift` 放行。

### 日常同步

1. 跑 `gcanvas:check`，看报红条目
2. 只有逐字件变化：跑 `gcanvas:sync`，然后 typecheck、vitest、开发入口目视
3. 有改写件 / 垫片报红：报红条目里给出了 `git -C <上游仓库> diff <该文件已对照的 commit> <新 commit> -- <上游路径>`，照着对照，把需要的改动搬进本地文件，再 `gcanvas:sync -- --accept`。先 sync 逐字件、后对照改写件也没问题：不加 `--accept` 的 sync 不会推进改写件 / 垫片的对照基准
4. 逐字件报「引用了本地不存在的 …」：上游新增了依赖文件，把它加进清单 `files`（能逐字就 `verbatim`，依赖编辑器状态的写垫片）后再 `sync`
5. `gcanvas:check` 回到「一致」；若有依赖版本「提示」，按需对齐本包 `package.json`

### 日常规矩

- G-canvas 每次发「会被分享的版本」（打正式包前）→ 在 PRD-Lab 跑 `gcanvas:check`；有漂移就开一轮「同步 → 对照 → 部署」。
- `deploy.sh` 拿 G-canvas 的**当前 HEAD** 比对：同步要对准准备分享出去的那个 commit（`-- --commit <rev>`）。同步后到部署前 G-canvas 若又提交了渲染相关改动，部署会被拦下——要么再同步一轮，要么确认无关后加 `--allow-gcanvas-drift`。
- G-canvas 改格式要保持向后兼容（查看器会用新代码重画所有历史画板）；做不到兼容时，在 `src/legacy-board.ts` 加旧格式转换（已有先例：旧箭头 `x1/y1/x2/y2` 转 `points`）。

### 画不了的元素

`src/known-elements.ts` 逐元素分类：已接入类型且通过 G-canvas 单元素校验的交给逐字件渲染；未接入的类型显示「暂不支持的元素」占位卡；数据不符合 G-canvas 格式的显示红色占位卡并写明第一条校验错误。占位卡按元素的 x/y/w/h 定位定尺寸（缺尺寸取 320×160）并计入框选全部。所以 G-canvas 新增元素类型后、查看器同步之前，含新类型的画板仍能打开，新元素先显示为占位卡。

## 接入新元素类型（以「富文本标注块」`note` 为例）

上游设计：`type: "note"`，正文在画板目录 `notes/<file>.md`，元素记 `file`（画板根视角路径）、`x/y/w/h`（`h` 为最小高度）、`color`、`sizeTier`。渲染器 `renderers/NoteView.tsx` 经渲染上下文里的 `noteContent.{cache, loader}` 取正文（不走 adapter 直取），用 full 档 Markdown 静态渲染；链接等交互行为与 G-canvas 一致，见上游 `NoteView`。

渲染器需要的数据除 adapter 外还可能经渲染上下文下发。note 的接线如下：

| 位置 | 做法 |
|---|---|
| `src/api.ts` `createCanvasAdapter` | 加 `loadNote: (_boardId, file) => fetchText(baseUrl, file)`（`file` 为画板根视角路径 `notes/…`）；垫片的 `CanvasAdapter` 类型取自它的返回值 |
| `src/gcanvas/ui/canvas/canvas-context.ts`（垫片） | `CanvasContextValue` 加可选字段 `noteContent: { cache: NoteContentCache; loader: NoteLoader }` |
| `src/gcanvas/ui/canvas/note/note-loader.ts`（改写件） | 逐行同上游，只把判 404 的错误类型换成本包 `api.ts` 的 `FetchError` |
| `src/Canvas.tsx` | 每块画板建一个 `NoteContentCache` 与 `createNoteLoader(...)`，放进上下文 `noteContent` |
| `src/gcanvas/ui/canvas/ElementLayer.tsx`（改写件） | `ElementBody` 加 `case 'note'`；上游的就地编辑槽不搬 |
| `src/known-elements.ts` | `RENDERED_TYPES` 加 `note: true` |

样式链：`prose.css` 用 Tailwind Typography 生成 `prose` 类，由 `vite.config.ts` 里的 `@tailwindcss/vite` 插件编译（只生成 `prose` / `prose-sm`，不带全局重置）；`content.css`（正文排版）与 `note.css`（卡片三色、字号）逐字复制。`src/main.tsx` 的引入顺序对应上游 `ui/main.tsx`：`base` → `canvas-engine` → `prose` → `content` → `rich-text` → `note` → 外壳 `styles.css`（`src/styles-entry.test.ts` 钉住）。

### 接入步骤（下一个新类型照此做）

**1. 跑 check，看报红**：`schema.ts` 等逐字件内容变了；`[改写件] ElementLayer.tsx`（分派多了新类型）；`[监视目录]` 里出现清单外的新文件；上游改了 `canvas-context.ts` 时 `[垫片]` 也报红。

**2. 新文件加进清单再同步**：渲染需要的文件加进 `gcanvas-sync.json` 的 `files`（`kind: "verbatim"`，`local` 为 `src/gcanvas/` 下同一相对路径，`upstreamSha256: null`），跑 `gcanvas:sync -- --commit <rev>`（不加 `--accept`，改写件与垫片的对照基准留在旧 commit，第 4 步的 diff 命令仍有效）。报「引用了本地不存在的 …」就按同样方式补；只给编辑器用的文件不复制，在垫片里不导出。

**3. 跑 typecheck，按报错改 PRD-Lab 自有代码**（逐字件一个字节不改）：`RENDERED_TYPES` 不满足 `Record<ElementType, true>` 就登记；`ElementBody` 的 `never` 分支报错就对照上游加分派；渲染器读不到的上下文字段补进垫片并在 `Canvas.tsx` 提供。

**4. 对照改写件与垫片**：按报红条目给出的 diff 命令逐文件对照，搬需要的 hunk；`watch` 的 `include` / 目录若漏了新文件的目录，在清单里补。然后 `gcanvas:sync -- --commit <rev> --accept`，`gcanvas:check -- --commit <rev>` 应回到「一致」。`--accept` 会把监视目录里的新文件一并记为已知，跑之前确认它们都已处理（复制或明确不需要）。

**5. 验证**

- `typecheck`、`vitest run` 全绿；补渲染用例（参考 `src/note.test.tsx`：卡片结构、正文接线、缺失与失败提示、安全、包围盒）
- `fixtures/` 放一块含新类型的画板，开发入口目视
- 上传链路：预览站按后缀给 `.md` 返回 `text/markdown`；确认发布打包带上 `notes/` 目录
- `build` 后 `dist` 只含 `index.html` 与 `assets/`

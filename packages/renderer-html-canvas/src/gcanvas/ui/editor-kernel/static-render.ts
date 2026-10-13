/**
 * 编辑内核 —— 静态 Markdown 渲染（D3：非编辑态轻量渲染）
 *
 * 画布几十上百个文本框只有「正在编辑的那一个」挂完整 Tiptap；其余静态渲染走本模块：
 * md → HTML 字符串（dangerouslySetInnerHTML 注入），渲染成本远低于编辑器实例。
 *
 * **单解析器消除双侧漂移**（D3 的「静态与编辑同配置」要求的强化实现）：
 * 不另起一套 marked 配置，而是持一个**常驻 headless 镜像编辑器**（与编辑侧同一
 * `buildExtensions(tier)` 装配、同一 `setMarkdownSafe` 安全灌入路径），用它把 md
 * 解析为文档再序列化为 HTML——静态侧与编辑侧由**同一份代码**产出同一文档结构，
 * 双击进出无语义跳变由构造保证（golden 对比测试仍钉死防回归）。
 * 注：@tiptap/markdown 内部即 marked，「轻量 marked 渲染」语义由此满足。
 *
 * 安全：输出经 engine/sanitize 的 sanitizeHtml 再注入（防 md 内嵌 <script>/事件属性/
 * javascript:——尽管 schema 化文档已不产这些，双层防线照设）。
 */
import type { Editor as TiptapEditor } from '@tiptap/core'
import { sanitizeHtml } from '../../engine/sanitize'
import type { EditorTier } from './extensions'
import { createHeadlessEditor, setMarkdownSafe } from './markdown'

/** 每档位一个常驻镜像编辑器（lazy；浏览器/jsdom 环境用，无 document 的纯 node 不会走到渲染） */
const mirrors = new Map<EditorTier, TiptapEditor>()

function mirrorEditor(tier: EditorTier): TiptapEditor {
  let ed = mirrors.get(tier)
  if (!ed || ed.isDestroyed) {
    ed = createHeadlessEditor(tier)
    ed.setEditable(false)
    mirrors.set(tier, ed)
  }
  return ed
}

/**
 * 本模块加载时把销毁函数登记到全局钩子，供测试 setup 在文件结束时统一收尾。
 * 走登记而不是 setup 直接 import 本模块：没用到静态渲染的文件不必为收尾去加载 Tiptap。
 */
const DISPOSERS_KEY = Symbol.for('hcanvas.disposeStaticRenderers')
const registry = globalThis as unknown as Record<symbol, Set<() => void> | undefined>
;(registry[DISPOSERS_KEY] ??= new Set()).add(() => disposeStaticRenderers())

/** 渲染结果缓存（同文档多文本框/重渲常见重复内容；上限防无界增长） */
const cache = new Map<string, string>()
const CACHE_MAX = 500

/**
 * 空段落（用户留的空行）占一行高：编辑器里 ProseMirror 往空段落放一个 `<br>` 撑出行高，
 * 静态侧照做，否则空行在静态显示里塌成零高、退出编辑后像是被删了。
 * 文末的空段落保持不占行——列表等块结尾时编辑器会自动补一个空段落供光标落脚，它不是用户留的空行。
 */
function blankParagraphsAsLines(html: string): string {
  const trailing = html.match(/(?:<p><\/p>)+$/)?.[0] ?? ''
  const body = html.slice(0, html.length - trailing.length)
  return body.replace(/<p><\/p>/g, '<p><br></p>') + trailing
}

/**
 * md → 安全 HTML 字符串。与编辑侧同装配同灌入路径（见模块头）；输出已经 sanitize。
 */
export function renderStaticMarkdown(tier: EditorTier, md: string): string {
  const key = `${tier}\u0000${md}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const ed = mirrorEditor(tier)
  setMarkdownSafe(ed, md)
  const raw = blankParagraphsAsLines(ed.getHTML())
  const { html } = sanitizeHtml(raw)

  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, html)
  return html
}

/**
 * 销毁各档镜像编辑器并清空渲染缓存；之后再调 renderStaticMarkdown 会按需重建，结果不变。
 * 镜像编辑器内的 DOM 观察器带延迟回调，宿主 DOM 环境（如 jsdom）先于回调拆除时会抛
 * 「document is not defined」。测试环境由 vitest.setup.ts 在每个文件结束时经全局钩子调用本函数。
 */
export function disposeStaticRenderers(): void {
  for (const ed of mirrors.values()) {
    if (!ed.isDestroyed) ed.destroy()
  }
  mirrors.clear()
  cache.clear()
}

/** 当前存活的镜像编辑器（只读探针，供测试断言销毁状态） */
export function liveStaticMirrors(): readonly TiptapEditor[] {
  return [...mirrors.values()].filter((ed) => !ed.isDestroyed)
}

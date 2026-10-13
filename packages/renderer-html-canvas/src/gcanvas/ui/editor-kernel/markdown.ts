/**
 * 编辑内核 —— Markdown 进出（D2 三件事之一）
 *
 * 内核对外只暴露 markdown 进出语义，不暴露 ProseMirror/Tiptap 内部状态：
 * - `setMarkdown(editor, md)`：把 md 灌进编辑器（setContent，contentType:'markdown'）
 * - `getMarkdown(editor)`：从编辑器取 md（@tiptap/markdown 的 getMarkdown）
 *
 * 另提供 `roundTripMarkdown(tier, md)`：无 DOM 的 headless 往返，
 * 供单测断言「md 进 → md 出」一致性（内核纯净性的核心验证手段）。
 */
import { Editor } from '@tiptap/core'
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { buildExtensions, type EditorTier } from './extensions'

/** 把 markdown 灌入编辑器（覆盖现有内容）。灌入是「加载」不是「编辑」：不发 update 事件 */
export function setMarkdown(editor: TiptapEditor, md: string): void {
  loadContent(editor, md, { contentType: 'markdown' })
}

/**
 * 载入内容 = 撤销历史的起点：事务带 `addToHistory:false`，载入不进撤销栈，
 * 用户撤销最多回到载入的内容、不会越过它变成空。同时不发 update 事件（载入不是编辑）。
 * 所有载入入口共用，避免各处各写一遍。
 */
function loadContent(
  editor: TiptapEditor,
  content: string | JSONContent,
  options: { contentType?: 'markdown' } = {},
): void {
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent(content, { ...options, emitUpdate: false })
    .run()
}

/** 取编辑器当前内容的 markdown 文本（@tiptap/markdown 在 Editor 上挂的 getMarkdown）。 */
export function getMarkdown(editor: TiptapEditor): string {
  return editor.getMarkdown()
}

/**
 * 纯文本 → 字面量文档 JSON（setMarkdownSafe 的兜底安全网用）：
 * 空行分段、段内单换行转硬换行，逐字保留可见内容。
 */
export function literalDocJSON(md: string): JSONContent {
  const paragraphs = md.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const content: JSONContent[] = paragraphs.map((para) => {
    const lines = para.split('\n')
    const inner: JSONContent[] = []
    lines.forEach((line, i) => {
      if (i > 0) inner.push({ type: 'hardBreak' })
      if (line !== '') inner.push({ type: 'text', text: line })
    })
    return inner.length > 0 ? { type: 'paragraph', content: inner } : { type: 'paragraph' }
  })
  return { type: 'doc', content }
}

/** 文档里除这些之外的节点（分隔线、表格、待办……）本身就是内容，不要求有文字 */
const TEXT_ONLY_NODES = new Set(['doc', 'paragraph', 'hardBreak', 'text'])

/** 灌入后文档是否「丢了内容」：源文非空，但文档既无文字、也没有任何结构节点 */
function lostContent(editor: TiptapEditor, md: string): boolean {
  if (md.trim() === '') return false
  const doc = editor.state.doc
  if (doc.textContent.trim() !== '') return false
  let hasStructure = false
  doc.descendants((node) => {
    if (!TEXT_ONLY_NODES.has(node.type.name)) hasStructure = true
    return !hasStructure
  })
  return !hasStructure
}

/**
 * 安全灌入（硬要求：不支持的 md 永不丢内容）——两层防线的兜底层：
 * 1. 常见不支持 token 已由 literal-fallback 扩展字面化（解析正常走通、其余格式保留）；
 * 2. 本函数兜未预期 token：解析抛错，或内容被清空（md 非空但文档既无文字也无结构节点）时，
 *    整文按纯文本段落灌入，逐字保留。分隔线、空格子的表格等无文字但有结构的内容属合法内容，不走兜底。
 * 返回 true = 触发了兜底回退（调用方可观测）。
 */
export function setMarkdownSafe(editor: TiptapEditor, md: string): boolean {
  let threw = false
  try {
    // emitUpdate:false——加载不是编辑，不得触发 onUpdate（否则脏追踪误标、双击进出 1:1 破功）
    loadContent(editor, md, { contentType: 'markdown' })
  } catch {
    // 解析/schema 失败：编辑器里可能还是上一份内容，必须走兜底整文灌入，不能沿用
    threw = true
  }
  if (!threw && !lostContent(editor, md)) return false
  loadContent(editor, literalDocJSON(md))
  return true
}

/**
 * 换成外部来的新内容，并清空编辑器内撤销历史：
 * 外部版本是新的起点，⌘Z 不能回到换内容之前的输入。
 * 做法：安全载入后，用同一组插件重建编辑状态（Tiptap 没有清历史的命令），选区截断到新文档范围内；
 * 再派一个不进历史、不改文档的空事务，让工具栏等订阅者刷新。全程不触发 `update`。
 */
export function resetMarkdownContent(editor: TiptapEditor, md: string): void {
  const oldFrom = editor.state.selection.from
  const oldTo = editor.state.selection.to
  setMarkdownSafe(editor, md)
  const { state, view } = editor
  const max = state.doc.content.size
  const clamp = (n: number) => Math.min(Math.max(n, 0), max)
  const selection = TextSelection.between(
    state.doc.resolve(clamp(oldFrom)),
    state.doc.resolve(clamp(oldTo)),
  )
  const fresh = EditorState.create({ doc: state.doc, plugins: state.plugins, selection })
  view.updateState(fresh)
  view.dispatch(view.state.tr.setMeta('addToHistory', false))
}

/**
 * headless（无 DOM 挂载）创建一个内核编辑器实例。
 * 用于单测做 markdown 往返、或非交互场景的 md⇄JSON 转换。
 * 调用方负责在用完后 `editor.destroy()`。
 */
export function createHeadlessEditor(tier: EditorTier, md = ''): TiptapEditor {
  return new Editor({
    extensions: buildExtensions(tier),
    content: md,
    // content 是 markdown 文本，须声明 contentType（@tiptap/markdown 扩展了 EditorOptions），否则按 html 解析
    contentType: 'markdown',
  })
}

/**
 * markdown 往返：md → 编辑器文档 → md。
 * 内核「干净 Markdown 进出」契约的可断言形态：对支持的语法应稳定还原。
 */
export function roundTripMarkdown(tier: EditorTier, md: string): string {
  const editor = createHeadlessEditor(tier)
  try {
    setMarkdownSafe(editor, md)
    return getMarkdown(editor)
  } finally {
    editor.destroy()
  }
}

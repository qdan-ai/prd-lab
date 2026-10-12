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
import { buildExtensions, type EditorTier } from './extensions'

/** 把 markdown 灌入编辑器（覆盖现有内容）。灌入是「加载」不是「编辑」：不发 update 事件 */
export function setMarkdown(editor: TiptapEditor, md: string): void {
  editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
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

/**
 * 安全灌入（硬要求：不支持的 md 永不丢内容）——两层防线的兜底层：
 * 1. 常见不支持 token 已由 literal-fallback 扩展字面化（解析正常走通、其余格式保留）；
 * 2. 本函数兜未预期 token：解析抛错或内容被清空（md 非空但文档无文本）时，
 *    整文按纯文本段落灌入，逐字保留。
 * 返回 true = 触发了兜底回退（调用方可观测）。
 */
export function setMarkdownSafe(editor: TiptapEditor, md: string): boolean {
  try {
    // emitUpdate:false——加载不是编辑，不得触发 onUpdate（否则脏追踪误标、双击进出 1:1 破功）
    editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
  } catch {
    // 解析/schema 失败 → 落入下方清空判定，走兜底
  }
  const lost = md.trim() !== '' && editor.state.doc.textContent.trim() === ''
  if (!lost) return false
  editor.commands.setContent(literalDocJSON(md), { emitUpdate: false })
  return true
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

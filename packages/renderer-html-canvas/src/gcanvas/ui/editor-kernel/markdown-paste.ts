/**
 * 编辑内核 —— 粘贴入口（两档都装）
 *
 * 剪贴板有三种来源，各自的结果：
 * - 纯文本（剪贴板只有 text/plain）：按 Markdown 源码解析，与 AI 写进文件的同一解析；
 *   档位不支持的语法按字面保留。⌘⇧V（plain）与代码块内不处理，走编辑器默认的纯文本粘贴。
 * - 带格式的富文本：按 schema 解析，支持的节点与标记保留，其余退化为文字。
 * - 「没有任何格式语义的富文本」（如代码编辑器复制 Markdown 源码：只有 div / span / br 与内联样式，
 *   纯文本与源码相同）：当作 Markdown 源码处理，同第一条。
 * 粘进表格格子时，非表格片段先压平成一段（块与块之间用硬换行），不新增行列；
 * 片段本身含表格行 / 格（从表格里复制几格）则不压平，交给表格插件按格粘贴。
 *
 * 片段只打开首尾的段落一端：纯段落并入光标所在行；标题、列表等作为独立块插入
 * （全部打开会把粘贴的标题并进当前段落而丢掉标题）。
 */
import { Extension } from '@tiptap/core'
import { Fragment, Node as PMNode, ResolvedPos, Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** 出现这些元素就认为 HTML 带有格式语义 */
const SEMANTIC_SELECTOR =
  'strong,b,em,i,s,del,code,pre,a,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,table,hr,mark,input'

const TABLE_NODES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader'])
const CELL_NODES = new Set(['tableCell', 'tableHeader'])

/** Markdown 文本 → 粘贴片段；解析失败或结果为空返回 undefined（调用方回退到默认行为） */
function markdownToSlice(view: EditorView, markdown: { parse: (md: string) => unknown } | undefined, text: string): Slice | undefined {
  if (!markdown || text.trim() === '') return undefined
  try {
    const json = markdown.parse(text.replace(/\r\n?/g, '\n'))
    const doc = PMNode.fromJSON(view.state.schema, json)
    if (doc.childCount === 0) return undefined
    const first = doc.firstChild!
    const last = doc.lastChild!
    return new Slice(doc.content, first.type.name === 'paragraph' ? 1 : 0, last.type.name === 'paragraph' ? 1 : 0)
  } catch {
    return undefined
  }
}

/** HTML 是否「没有格式语义，且纯文本与 text/plain 相同」 */
export function isUnformattedHtml(html: string, text: string): boolean {
  if (typeof DOMParser === 'undefined' || text.trim() === '') return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc.body.querySelector(SEMANTIC_SELECTOR)) return false
  const strip = (s: string) => s.replace(/\s+/g, '')
  return strip(doc.body.textContent ?? '') === strip(text)
}

function selectionInCell($from: ResolvedPos): boolean {
  for (let d = $from.depth; d > 0; d--) {
    if (CELL_NODES.has($from.node(d).type.name)) return true
  }
  return false
}

function containsTableParts(slice: Slice): boolean {
  let found = false
  slice.content.descendants((node) => {
    if (TABLE_NODES.has(node.type.name)) found = true
    return !found
  })
  return found
}

/** 片段压平成一段：每个文字块是一行，行间用硬换行 */
function flattenSlice(view: EditorView, slice: Slice): Slice {
  const { hardBreak, paragraph } = view.state.schema.nodes
  if (!hardBreak || !paragraph) return slice
  const lines: Fragment[] = []
  let loose: PMNode[] = []
  const flushLoose = () => {
    if (loose.length > 0) lines.push(Fragment.from(loose))
    loose = []
  }
  const walk = (frag: Fragment) => {
    frag.forEach((node) => {
      if (node.isInline) {
        loose.push(node)
        return
      }
      flushLoose()
      if (node.isTextblock) lines.push(node.content)
      else walk(node.content)
    })
  }
  walk(slice.content)
  flushLoose()
  const inline: PMNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) inline.push(hardBreak.create())
    line.forEach((n) => inline.push(n))
  })
  return new Slice(Fragment.from(paragraph.create(null, inline)), 1, 1)
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
])

/**
 * 粘进格子的 HTML 先压成一段：格子只容得下一个段落，ProseMirror 解析多个块时会把每块各包成一个新格子，
 * 所以必须在解析之前把块与块之间改成 `<br>`。含表格结构（从表格复制）的 HTML 原样放行。
 */
function flattenHtmlForCell(html: string): string {
  if (typeof DOMParser === 'undefined' || /<(table|tr|td|th)[\s>]/i.test(html)) return html
  const body = new DOMParser().parseFromString(html, 'text/html').body
  const lines: string[] = []
  let loose = ''
  const flushLoose = () => {
    if (loose.trim() !== '') lines.push(loose)
    loose = ''
  }
  const walk = (parent: Node) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === 1 && BLOCK_TAGS.has((child as Element).tagName)) {
        flushLoose()
        const el = child as Element
        if (el.querySelector('p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,pre')) walk(el)
        else lines.push(el.innerHTML)
      } else if (child.nodeType === 1) {
        loose += (child as Element).outerHTML
      } else if (child.nodeType === 3) {
        loose += (child.textContent ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      }
    })
  }
  walk(body)
  flushLoose()
  return `<p>${lines.join('<br>')}</p>`
}

/** 选区在表格格子内、且片段不含表格结构时压平 */
function flattenForCell(view: EditorView, slice: Slice): Slice {
  if (!selectionInCell(view.state.selection.$from) || containsTableParts(slice)) return slice
  return flattenSlice(view, slice)
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const getMarkdown = () => (this.editor as unknown as { markdown?: { parse: (md: string) => unknown } }).markdown
    return [
      new Plugin({
        props: {
          // 纯文本：按 Markdown 源码解析。plain（⌘⇧V）返回 undefined，走默认的按行成段
          clipboardTextParser(text, _$context, plain, view) {
            if (plain) return undefined as unknown as Slice
            return markdownToSlice(view, getMarkdown(), text) as unknown as Slice
          },
          transformPastedHTML(html, view) {
            return selectionInCell(view.state.selection.$from) ? flattenHtmlForCell(html) : html
          },
          transformPasted(slice, view) {
            return flattenForCell(view, slice)
          },
          // 无格式语义的富文本按 Markdown 源码处理
          handlePaste(view, event) {
            const data = (event as ClipboardEvent).clipboardData
            if (!data) return false
            if ((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey) return false
            if (view.state.selection.$from.parent.type.spec.code) return false
            const html = data.getData('text/html')
            const text = data.getData('text/plain')
            if (!html || !isUnformattedHtml(html, text)) return false
            const slice = markdownToSlice(view, getMarkdown(), text)
            if (!slice) return false
            const flat = flattenForCell(view, slice)
            view.dispatch(view.state.tr.replaceSelection(flat).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
            return true
          },
        },
      }),
    ]
  },
})

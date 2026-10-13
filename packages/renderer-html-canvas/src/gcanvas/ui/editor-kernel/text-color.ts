/**
 * 编辑内核 —— 文字颜色 mark
 *
 * Markdown 写法：`<span style="color: #D92D20">文字</span>`。
 * - 工具栏只给 5 个预设色 + 默认（`TEXT_COLOR_PRESETS`），但文件里任何合法颜色值
 *   （hex / rgb() / 颜色名）都照显照存，原值写回、不改写。
 * - 颜色值必须过 `isCleanColor`（与画布颜色字段同一道字符白名单），不过则整个 span
 *   不当颜色处理：标签丢、文字留。
 * - 一个 span 上只认 `color`；`font-weight`、`class` 等其它样式与属性一律丢弃。
 *
 * 为什么自写分词器：marked 默认把 `<span …>…</span>` 当原始行内 HTML，里层的 Markdown
 * （加粗、链接、行内代码）不再解析。这里把 span 内部交回行内分词，颜色与其它格式可叠加。
 */
import { Mark, mergeAttributes } from '@tiptap/core'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { isCleanColor } from '../../engine/schema'

/** 工具栏颜色板：5 个预设色（默认色 = 清除颜色，不在此列） */
export const TEXT_COLOR_PRESETS = [
  { name: '红', value: '#D92D20' },
  { name: '橙', value: '#DC6803' },
  { name: '绿', value: '#079455' },
  { name: '蓝', value: '#1570EF' },
  { name: '紫', value: '#7A5AF8' },
] as const

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      /** 给选区设文字颜色（值须通过 `isCleanColor`，否则不生效） */
      setTextColor: (color: string) => ReturnType
      /** 清除选区的文字颜色 */
      unsetTextColor: () => ReturnType
    }
  }
}

const OPEN_TAG = /^<span\b([^>]*)>/i
const ANY_SPAN_TAG = /<(\/?)span\b[^>]*>/gi
const STYLE_ATTR = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i
const COLOR_DECL = /(?:^|;)\s*color\s*:\s*([^;]+)/i

/** 从 style 声明串取 `color` 的值（锚在开头或分号后，`background-color` 不会命中）；取不到或不干净返回 null */
function colorFromStyle(style: string): string | null {
  const m = COLOR_DECL.exec(style)
  if (!m) return null
  const value = (m[1] ?? '').trim()
  return isCleanColor(value) ? value : null
}

/** 从开标签的属性串取干净的颜色值 */
function colorFromAttrs(attrs: string): string | null {
  const m = STYLE_ATTR.exec(attrs)
  if (!m) return null
  return colorFromStyle(m[1] ?? m[2] ?? '')
}

function isPreset(color: string): boolean {
  const lower = color.toLowerCase()
  return TEXT_COLOR_PRESETS.some((p) => p.value.toLowerCase() === lower)
}

/** 给还没有颜色、且允许叠加颜色的文字节点加上颜色标记（内层优先：已有颜色的不动） */
function paintText(nodes: JSONContent[], color: string): JSONContent[] {
  return nodes.map((n) => {
    if (n.type === 'text') {
      const marks = n.marks ?? []
      // 行内代码不与其它标记共存；已有颜色的文字属于内层 span，保持内层颜色
      if (marks.some((m) => m.type === 'textColor' || m.type === 'code')) return n
      return { ...n, marks: [...marks, { type: 'textColor', attrs: { color } }] }
    }
    if (n.content) return { ...n, content: paintText(n.content, color) }
    return n
  })
}

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        // 序列化到 HTML 由 renderHTML 统一输出，属性层不重复输出
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      // 本应用自己渲染出的颜色（含任意合法色值）：无损往返
      {
        tag: 'span[data-hc-color]',
        getAttrs: (el) => {
          const color = (el as HTMLElement).getAttribute('data-hc-color') ?? ''
          return isCleanColor(color) ? { color } : false
        },
      },
      // 外来 HTML：只认 5 个预设色，避免网页复制常带的满屏灰黑色把粘贴内容染杂
      {
        tag: 'span[style]',
        getAttrs: (el) => {
          const color = colorFromStyle((el as HTMLElement).getAttribute('style') ?? '')
          return color && isPreset(color) ? { color: color.toUpperCase() } : false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const color = String(mark.attrs.color ?? '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, { style: `color: ${color}`, 'data-hc-color': color }),
      0,
    ]
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          isCleanColor(color) ? commands.setMark(this.name, { color }) : false,
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },

  renderMarkdown: (node, h) => {
    const content = h.renderChildren(node)
    const color = String((node.attrs as { color?: string } | undefined)?.color ?? '')
    if (!isCleanColor(color)) return content
    return `<span style="color: ${color}">${content}</span>`
  },

  parseMarkdown: (token, h) => {
    const color = String((token as { color?: string }).color ?? '')
    if (color === '') return [] // 孤立的开标签：只丢标签
    const inner = h.parseInline(token.tokens ?? [])
    return paintText(inner, color)
  },

  markdownTokenizer: {
    name: 'textColor',
    level: 'inline',
    start: (src: string) => src.search(/<span\b/i),
    tokenize(src, _tokens, h) {
      const open = OPEN_TAG.exec(src)
      if (!open) return undefined

      // 按深度找与开标签配对的 </span>
      ANY_SPAN_TAG.lastIndex = open[0].length
      let depth = 1
      let m: RegExpExecArray | null
      let closeAt = -1
      let closeEnd = -1
      while ((m = ANY_SPAN_TAG.exec(src)) !== null) {
        depth += m[1] ? -1 : 1
        if (depth === 0) {
          closeAt = m.index
          closeEnd = m.index + m[0].length
          break
        }
      }

      // 未闭合：只吃掉孤立的开标签、保留后面的文字（交给通用 HTML 路径会产出非法的嵌套段落）
      if (closeAt < 0) {
        return { type: 'textColor', raw: open[0], text: '', color: '', tokens: [] } as MarkdownToken
      }

      const color = colorFromAttrs(open[1] ?? '')
      if (!color) return undefined // 非颜色 span：交回通用行内 HTML 路径（标签丢、文字留）
      const inner = src.slice(open[0].length, closeAt)
      if (inner === '') return undefined
      return {
        type: 'textColor',
        raw: src.slice(0, closeEnd),
        text: inner,
        color,
        tokens: h.inlineTokens(inner),
      } as MarkdownToken
    },
  },
})

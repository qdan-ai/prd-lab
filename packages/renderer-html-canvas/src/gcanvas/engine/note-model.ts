/**
 * 标注块（note）的无状态规则：常量、文件名合法性、显示高度、文件名派生。
 * 前后端共用（服务端可直接 import），不依赖任何运行时状态。
 */

export const NOTE_DIR = 'notes'
export const NOTE_COLORS = ['yellow', 'blue', 'gray'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]
export const NOTE_DEFAULT_COLOR: NoteColor = 'yellow'
export const NOTE_SIZE_TIERS = ['small', 'medium', 'large'] as const
export type NoteSizeTier = (typeof NOTE_SIZE_TIERS)[number]
export const NOTE_DEFAULT_SIZE_TIER: NoteSizeTier = 'medium'
/** 档位 → 卡片正文字号（世界坐标 px）；标题 / 表格 / 代码等随正文等比缩放 */
export const NOTE_FONT_SIZES: Record<NoteSizeTier, number> = { small: 26, medium: 30, large: 36 }
export const NOTE_DEFAULT_W = 480
/** 新建标注的初始「至少高度」 */
export const NOTE_DEFAULT_H = 160
export const NOTE_MIN_W = 120
/** 一行正文 + 上下内边距 + 边框 */
export const NOTE_MIN_H = 40

const NOTE_EXT = '.md'
const NOTE_FILE_NAME_MAX = 120
/** 派生文件名的标题部分上限（code point） */
const DERIVE_TITLE_MAX = 60

/** notes/ 下纯文件名：安全段（无 / \ NUL、非 . ..）、不以 . 开头、以 .md 结尾（区分大小写）、≤ 120 个字符 */
export function isNoteFileName(name: string): boolean {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..') return false
  if (/[/\\\0]/.test(name)) return false
  if (name.startsWith('.')) return false
  if (!name.endsWith(NOTE_EXT) || name.length === NOTE_EXT.length) return false
  return Array.from(name).length <= NOTE_FILE_NAME_MAX
}

/** 画板根视角路径：恰为 `notes/` + isNoteFileName */
export function isNoteFilePath(rel: string): boolean {
  if (typeof rel !== 'string') return false
  const prefix = `${NOTE_DIR}/`
  return rel.startsWith(prefix) && isNoteFileName(rel.slice(prefix.length))
}

/** 'notes/a.md' → 'a.md' */
export function noteFileName(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? rel : rel.slice(i + 1)
}

/** 卡片字号（px）；档位缺省按中 */
export function noteFontSize(el: { sizeTier?: NoteSizeTier }): number {
  return NOTE_FONT_SIZES[el.sizeTier ?? NOTE_DEFAULT_SIZE_TIER]
}

/** 显示高度：max(h, measured.h)；measured 缺省时 = h */
export function noteDisplayHeight(el: { h: number; measured?: { h: number } }): number {
  return el.measured ? Math.max(el.h, el.measured.h) : el.h
}

/**
 * 由标题派生文件名：去首尾空白、NFC 正规化，/ \ : * ? " < > | 与控制字符换成 -，
 * 连续空白成 -，去掉开头的 .，截到 60 个字（按 code point），补 .md；
 * 结果为空 → `${fallbackId}.md`。
 */
export function deriveNoteFileName(title: string, fallbackId: string): string {
  let s = title.normalize('NFC').trim()
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '-')
  s = s.replace(/\s+/g, '-')
  s = s.replace(/^\.+/, '')
  s = Array.from(s).slice(0, DERIVE_TITLE_MAX).join('')
  return s === '' ? `${fallbackId}${NOTE_EXT}` : `${s}${NOTE_EXT}`
}

const FENCE_LINE = /^(```|~~~)/
const HR_LINE = /^([-*_])(\s*\1){2,}$/
const TABLE_SEPARATOR_LINE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/

/** 去掉行首块级标记（标题、引用、列表、待办），可叠加 */
function stripBlockPrefix(line: string): string {
  let s = line
  for (;;) {
    const next = s
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trimStart()
    if (next === s) return s
    s = next
  }
}

/** 去掉行内标记，只留文字 */
function stripInlineMarks(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\*\*|__|~~|==|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 正文首行的纯文字（给 ls、引用芯片、文件名派生用）：跳过空行与代码围栏行，去掉行首标记
 * （# 标题、> 引用、- * + 1. 列表、- [ ] / - [x] 待办、| 表格竖线），去掉行内标记
 * （**、__、~~、==、`、<span …> 与 </span>、<br>、[文字](链接) 取文字），连续空白并一个，按 code point 截到 max。
 * 全文没有可显示文字 → ''。
 *
 * 只求「人一眼认得出是哪条」，不求还原所有语法；表格行取各格文字用「 / 」连起来；分隔线当空行跳过。
 */
export function noteFirstLine(markdown: string, max = 40): string {
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || FENCE_LINE.test(line) || HR_LINE.test(line)) continue
    let text: string
    if (line.startsWith('|')) {
      if (TABLE_SEPARATOR_LINE.test(line)) continue
      text = line
        .split('|')
        .map((cell) => stripInlineMarks(cell))
        .filter((cell) => cell !== '')
        .join(' / ')
    } else {
      text = stripInlineMarks(stripBlockPrefix(line))
    }
    if (text === '') continue
    return Array.from(text).slice(0, max).join('')
  }
  return ''
}

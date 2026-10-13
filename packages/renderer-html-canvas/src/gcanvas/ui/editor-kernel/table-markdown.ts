/**
 * 编辑内核 —— 表格的 Markdown 序列化与格子模型
 *
 * GFM 表格的格子只有一行文字。本模块把编辑器里的表格收紧到同一件事上：
 * - 格子内容只放一段（`content: 'paragraph'`）：格内回车不分段，要换行按 Shift+回车（硬换行）。
 * - 写进文件时，格内硬换行存成 `<br>`，文字里的 `|` 存成 `\|`（含行内代码里的）；
 *   读回时 `<br>` 经行内 HTML 解析还原为硬换行，`\|` 由 marked 还原为 `|`，往返稳定。
 * - 文件里不出现上游序列化器用于拼接多块格子的 U+001F 控制字符：
 *   序列化前先把每个格子压成单段，再复用上游 `renderTableToMarkdown` 做对齐与列宽补齐。
 *
 * 做法：序列化前用一对私用区字符做占位（换行 / 竖线），交给上游渲染，输出后再替换成最终写法。
 * 占位字符若已出现在表格正文里，从候选列表中换一对未出现的，保证替换不误伤正文。
 */
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { Table, TableCell, TableHeader, renderTableToMarkdown } from '@tiptap/extension-table'

/** 候选占位对 [换行, 竖线]，均为 Unicode 私用区字符 */
const PLACEHOLDER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['', ''],
  ['', ''],
  ['', ''],
  ['', ''],
  ['', ''],
]

/** 从候选里挑一对没出现在 haystack 里的；候选全被占用（病态输入）时在私用区里继续找 */
function pickPlaceholders(haystack: string): readonly [string, string] {
  for (const pair of PLACEHOLDER_PAIRS) {
    if (!haystack.includes(pair[0]) && !haystack.includes(pair[1])) return pair
  }
  for (let code = 0xe010; code < 0xf8fe; code += 2) {
    const a = String.fromCharCode(code)
    const b = String.fromCharCode(code + 1)
    if (!haystack.includes(a) && !haystack.includes(b)) return [a, b]
  }
  return ['\uE000', '\uE001']
}

/** 内容是行内节点的块 */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

/** 收集格子里所有文字块的行内内容；每个文字块为一"行"。直接挂在格子下的行内节点合成一行 */
function collectLines(nodes: JSONContent[], out: JSONContent[][]): void {
  let loose: JSONContent[] = []
  const flushLoose = () => {
    if (loose.length > 0) out.push(loose)
    loose = []
  }
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'hardBreak') {
      loose.push(node)
      continue
    }
    flushLoose()
    if (TEXTBLOCKS.has(node.type ?? '')) out.push(node.content ?? [])
    else collectLines(node.content ?? [], out)
  }
  flushLoose()
}

/** 把一个格子压成单段：行间、硬换行都换成换行占位，竖线换成竖线占位 */
function flattenCell(cell: JSONContent, br: string, pipe: string): JSONContent {
  const lines: JSONContent[][] = []
  collectLines(cell.content ?? [], lines)
  const inline: JSONContent[] = []
  lines.forEach((line, i) => {
    if (i > 0) inline.push({ type: 'text', text: br })
    for (const n of line) {
      if (n.type === 'hardBreak') inline.push({ type: 'text', text: br })
      else if (n.type === 'text' && n.text) inline.push({ ...n, text: n.text.split('|').join(pipe) })
    }
  })
  const paragraph: JSONContent = inline.length > 0 ? { type: 'paragraph', content: inline } : { type: 'paragraph' }
  return { ...cell, content: [paragraph] }
}

/** 表格节点 JSON → Markdown 文本（格内换行 `<br>`、竖线 `\|`，无控制字符） */
export function renderTableMarkdown(
  node: JSONContent,
  helpers: Parameters<typeof renderTableToMarkdown>[1],
): string {
  const [br, pipe] = pickPlaceholders(JSON.stringify(node))
  const flat: JSONContent = {
    ...node,
    content: (node.content ?? []).map((row) => ({
      ...row,
      content: (row.content ?? []).map((cell) => flattenCell(cell, br, pipe)),
    })),
  }
  return renderTableToMarkdown(flat, helpers).split(br).join('<br>').split(pipe).join('\\|')
}

/** 表格扩展三件：序列化走 renderTableMarkdown 且关闭列宽拖动（列宽存不进 Markdown）、格子单段 */
export function tableExtensions(): AnyExtension[] {
  return [
    Table.extend({
      renderMarkdown: (node, h) => renderTableMarkdown(node, h),
    }).configure({ resizable: false }),
    TableCell.extend({ content: 'paragraph' }),
    TableHeader.extend({ content: 'paragraph' }),
  ]
}

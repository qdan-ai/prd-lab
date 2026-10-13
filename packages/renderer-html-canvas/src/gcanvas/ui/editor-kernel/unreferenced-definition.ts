/**
 * 链接定义行（`[id]: url "标题"`）是否孤立 —— 纯函数，供 literal-fallback 的块级分词器使用。
 *
 * 引用写法（GFM）：`[文字][id]`、`[id][]`、`[id]`（图片前面多一个 `!`）。
 * 判断在整篇原文上做、去掉代码围栏与行内代码；`[id](url)` 是行内链接、`[id]:` 是定义本身，都不算引用。
 * 误判方向取「多显示一行」：拿不准时当孤立，不会丢字。
 */

/** 与 marked 内置的块级定义规则一致，保证「这里认为是定义」与「marked 认为是定义」同步 */
const DEFINITION =
  /^ {0,3}\[((?!\s*\])(?:\\[\s\S]|[^\[\]\\])+)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)((?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))))? *(?:\n+|$)/

/** 所有定义行（含它们的后续标题行不需要精确：整行删除即可） */
const DEFINITION_LINES = /^ {0,3}\[[^\]\n]+\]:.*$/gm
const FENCED = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|$(?![\s\S]))/gm
const INLINE_CODE = /(`+)[^`]*?\1/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `src` 以一条孤立的定义行开头时返回这条定义的原文（含行尾换行），否则返回 undefined。
 * `before` 是同一层级里已经分出去的内容原文，与 `src` 拼起来是整篇。
 */
export function unreferencedDefinition(src: string, before: string): string | undefined {
  const m = DEFINITION.exec(src)
  if (!m) return undefined
  const label = m[1] ?? ''
  const rest = src.slice(m[0].length)
  const haystack = (before + rest)
    .replace(FENCED, '')
    .replace(DEFINITION_LINES, '')
    .replace(INLINE_CODE, '')
  // 标签比较：不分大小写、连续空白折叠（与 marked 登记定义的规则一致）
  const pattern = label
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+')
  const reference = new RegExp(`(?<!\\\\)\\[${pattern}\\](?!\\()`, 'i')
  return reference.test(haystack) ? undefined : m[0]
}

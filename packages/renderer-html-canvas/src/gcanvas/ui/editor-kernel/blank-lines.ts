/**
 * 编辑内核 —— 空段落（用户刻意留的空行）的读回
 *
 * 文件写法沿用 @tiptap/markdown：两个块之间多出一组空行（`\n\n\n\n`）= 一个空段落，
 * 同一处第二个起的空段落写 `&nbsp;`。读回时，@tiptap/markdown 只从顶层 `space` token
 * （块与块之间的空白）数出空段落个数。
 *
 * 但不少块级 token 会把自己后面的空行吞进自身 `raw`，空行就不再落进 `space` token：
 * 有序列表与待办列表的自定义分词器、marked 的标题与表格分词器都会这样。吞掉后读回少一个
 * 空段落，下一次保存就真的从文件里没了。
 *
 * 本模块在顶层分词结果上统一归位：把每个非空白块 `raw` 末尾的换行挪进紧随其后的
 * `space` token（没有就补一个），让空段落个数只由块之间的换行总数决定，与具体是哪种块无关。
 * 挂载方式是给 Markdown 扩展注入一个包装过的 marked：只换顶层分词器（`Lexer#lex`），
 * 扩展注册、选项、嵌套分词仍走 @tiptap/markdown 自带的那份 marked。
 */
import { MarkdownManager } from '@tiptap/markdown'
import type { Token, TokensList } from 'marked'

type Marked = MarkdownManager['instance']

/** 块 `raw` 末尾的换行（含只有空白字符的行）；块内容自身的行尾空格不在其中 */
const TRAILING_NEWLINES = /(?:\n[^\S\n]*)+$/

/**
 * 把顶层块吞掉的尾随换行挪回其后的 `space` token。原地修改并返回同一数组
 * （marked 在数组上挂着 `links` 等属性，换新数组会丢）。
 */
export function returnAbsorbedBlankLines(tokens: TokensList): TokensList {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token || token.type === 'space') continue
    const trailing = token.raw.match(TRAILING_NEWLINES)?.[0]
    if (!trailing) continue
    tokens[i] = { ...token, raw: token.raw.slice(0, token.raw.length - trailing.length) } as Token
    const next = tokens[i + 1]
    if (next?.type === 'space') {
      tokens[i + 1] = { ...next, raw: trailing + next.raw }
    } else {
      tokens.splice(i + 1, 0, { type: 'space', raw: trailing })
    }
    i += 1
  }
  return tokens
}

let wrapped: Marked | undefined

/**
 * 供 `Markdown.configure({ marked })` 注入的 marked：与 @tiptap/markdown 默认用的是同一份
 * （扩展分词器注册在它身上），只把 `Lexer` 换成顶层结果经 `returnAbsorbedBlankLines` 归位的子类。
 */
export function markedWithBlankLines(): Marked {
  if (wrapped) return wrapped
  const base = new MarkdownManager().instance
  class BlankLineLexer extends base.Lexer {
    override lex(src: string) {
      return returnAbsorbedBlankLines(super.lex(src))
    }
  }
  wrapped = Object.create(base, { Lexer: { value: BlankLineLexer } }) as Marked
  return wrapped
}

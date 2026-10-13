/**
 * 编辑内核 —— 不支持语法的字面量回退（D1 档位边界的无损化）
 *
 * 问题：@tiptap/markdown 对「无对应扩展的 token」默认按 token 类型直产节点 JSON，
 * 命中未注册的节点类型时整个 setContent 失败 → 文档被清空。画布场景这是数据丢失炸弹：
 * AI 生成的 text 元素完全可能含 `#`/`>` 开头文本，双击→空→失焦提交→内容被清空。
 *
 * 解法（硬要求：不支持的 md 永不丢内容）：
 * 1. 本文件——为「当前档位未装扩展」的 token 注册**字面量直通处理器**：块级 token
 *    （标题/引用/代码块/分割线/表格/原始 HTML/链接定义）原文转普通段落（保留换行为硬换行），
 *    行内 token（行内代码/链接/图片）原文转纯文本。所见即所得：`# x` 显示为字面 `# x`。
 * 2. markdown.ts `setMarkdownSafe`——兜底安全网：解析仍失败/内容被清空时整文按纯文本段落灌入。
 * 两层叠加保证任何 md 输入都不丢可见内容；静态渲染与编辑共用同一装配（extensions.ts），
 * 两侧行为一致。
 *
 * 序列化往返说明：字面化后的段落文本在 getMarkdown 时会被序列化器反斜杠转义
 * （`# x` → `\# x`，防再解析为标题），可见内容不变；「双击进出未编辑」场景由调用方
 * 的「无编辑不提交」纪律保证落盘 1:1（见 canvas/edit-session）。
 */
import { Extension } from '@tiptap/core'
import type { AnyExtension, JSONContent, MarkdownToken } from '@tiptap/core'
import { unreferencedDefinition } from './unreferenced-definition'

/** parseMarkdown helpers 的本文件用到的最小面（核心 d.ts 的 MarkdownParseHelpers 子集） */
interface ParseHelpers {
  createTextNode: (text: string, marks?: Array<{ type: string; attrs?: unknown }>) => JSONContent
  createNode: (type: string, attrs?: unknown, content?: JSONContent[]) => JSONContent
}

/** token 原文（块级 token 去尾换行）；marked 各类 token 均带 raw */
function rawOf(token: MarkdownToken): string {
  const t = token as { raw?: string; text?: string }
  return (t.raw ?? t.text ?? '').replace(/\n+$/, '')
}

/** 块级字面量：原文转单个段落，内部换行转硬换行（视觉保留多行结构） */
function literalBlock(token: MarkdownToken, h: ParseHelpers): JSONContent {
  const lines = rawOf(token).split('\n')
  const content: JSONContent[] = []
  lines.forEach((line, i) => {
    if (i > 0) content.push(h.createNode('hardBreak'))
    if (line !== '') content.push(h.createTextNode(line))
  })
  return h.createNode('paragraph', undefined, content.length > 0 ? content : undefined)
}

/** 行内字面量：原文转纯文本节点 */
function literalInline(token: MarkdownToken, h: ParseHelpers): JSONContent {
  const text = rawOf(token)
  // createTextNode 不接受空串（ProseMirror 空 text 节点非法）→ 以单空格兜底（仅理论路径）
  return h.createTextNode(text !== '' ? text : ' ')
}

/** 造一个「token → 字面量」直通扩展（无 schema 贡献，仅 markdown 解析处理器） */
function literalExtension(tokenName: string, kind: 'block' | 'inline'): AnyExtension {
  return Extension.create({
    name: `literal_${tokenName}`,
    markdownTokenName: tokenName,
    // @tiptap/markdown 经 registerExtension 读取本处理器；handler 签名见核心 MarkdownParseHelpers
    parseMarkdown: (token: MarkdownToken, helpers: unknown) =>
      kind === 'block'
        ? literalBlock(token, helpers as ParseHelpers)
        : literalInline(token, helpers as ParseHelpers),
  } as Parameters<typeof Extension.create>[0])
}

/**
 * light 档字面量直通集：覆盖 light 未装扩展的全部常见 token。
 * 仅注册「该档位确实无对应扩展」的 token——已有扩展的 token 不注册（处理器按注册序
 * 尝试，注册会遮蔽正版处理器）。
 */
export function literalFallbackExtensions(tier: 'light' | 'full'): AnyExtension[] {
  const block = (name: string) => literalExtension(name, 'block')
  const inline = (name: string) => literalExtension(name, 'inline')
  if (tier === 'light') {
    return [
      // 块级：light 无 heading/blockquote/codeBlock/hr/table 扩展
      block('heading'),
      block('blockquote'),
      block('code'), // 缩进/围栏代码块
      block('hr'),
      block('table'),
      block('html'), // 原始 HTML 块 → 字面文本（不执行、不渲染；sanitize 另兜静态侧）
      block('def'), // 链接引用定义
      // 行内：light 无 code（行内代码）/link/image 扩展
      inline('codespan'),
      inline('link'),
      inline('image'),
    ]
  }
  // full 档：heading/blockquote/code/codeBlock/hr/table/link 已装真扩展；
  // 仍无 image 节点与原始 HTML 处理 → 字面量直通（批4 接 docs 时可换真扩展）。
  // 链接引用定义（`[id]: url`）：full 档的链接由 marked 按定义解析成带地址的行内链接，
  // 被引用的定义行不进正文；没有任何地方引用的定义行按字面保留在原位置（见 orphanDefinition）。
  return [block('html'), inline('image'), orphanDefinition()]
}

/**
 * 孤立的链接定义行（整篇没有任何引用指向它）：块级分词器在定义行处判断，
 * 孤立则产出字面段落、被引用则放行给 marked 的内置定义处理（静默并入链接地址表）。
 * 判断需要整篇上下文：同层已分出的块的原文（`tokens`）加上剩余原文（`src`）就是整篇。
 * 定义写在容器（列表项、引用块）里时只看得到容器内文，容器外的引用看不到，此时按孤立处理——多显示一行，不丢字。
 */
function orphanDefinition(): AnyExtension {
  const NAME = 'orphanDefinition'
  return Extension.create({
    name: `literal_${NAME}`,
    markdownTokenName: NAME,
    markdownTokenizer: {
      name: NAME,
      level: 'block',
      // 不参与段落截断判定：定义行跟在段落后面时仍属同一段（与 marked 内置行为一致）
      start: () => -1,
      tokenize: (src: string, tokens: MarkdownToken[]) => {
        const raw = unreferencedDefinition(src, tokens.map((t) => (t as { raw?: string }).raw ?? '').join(''))
        return raw === undefined ? undefined : ({ type: NAME, raw } as MarkdownToken)
      },
    },
    parseMarkdown: (token: MarkdownToken, helpers: unknown) => literalBlock(token, helpers as ParseHelpers),
  } as Parameters<typeof Extension.create>[0])
}

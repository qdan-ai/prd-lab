/**
 * 编辑内核 —— 扩展装配（D2：一内核两档位）
 *
 * `buildExtensions(tier)` 按档位装配 Tiptap 扩展集，是内核唯一的扩展真相源。
 * 静态渲染侧（marked，Step 10）与编辑侧（Tiptap）须共用同一组 markdown 扩展配置，
 * 故档位定义集中在此，两侧从同一处取，杜绝双解析器行为漂移。
 *
 * 两档位（light = 画布文字元素，full = docs 面板与标注块；两档同一份解析，静态渲染与编辑共用）：
 *
 * | 能力                                   | light               | full            |
 * | -------------------------------------- | ------------------- | --------------- |
 * | 加粗 / 斜体 / 删除线 / `==高亮==`      | 编辑 + 按钮         | 编辑 + 按钮     |
 * | 有序 / 无序列表                        | 编辑 + 按钮         | 编辑 + 按钮     |
 * | 待办 `- [ ]` / `- [x]`（可嵌套）       | 显示与保存，无按钮  | 编辑 + 按钮     |
 * | 文字颜色 `<span style="color: …">`     | 显示与保存，无按钮  | 编辑 + 颜色板   |
 * | 标题 / 引用 / 代码块 / 分割线 / 表格   | 字面显示            | 编辑            |
 * | 行内代码 / 链接（含引用式链接）        | 字面显示            | 编辑            |
 * | 图片、块级原始 HTML                    | 字面显示            | 字面显示        |
 *
 * 「显示与保存」= 能解析、能渲染、编辑后原样写回，只是工具栏不给按钮（按钮是否出现见
 * `toolbarCapabilities`）。「字面」= 原文当普通文字显示、不丢字（见 literal-fallback.ts）。
 * 无下划线、无字体/字号片段扩展：这些是整框级字段，存 canvas.json，渲染时套容器 CSS，不进 Markdown。
 * 锚点节点（AnchorMarkerNode）接入时在 full 档追加，此处预留装配位。
 */
import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Highlight } from '@tiptap/extension-highlight'
import { TableRow } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { literalFallbackExtensions } from './literal-fallback'
import { TextColor } from './text-color'
import { tableExtensions } from './table-markdown'
import { MarkdownPaste } from './markdown-paste'
import { markedWithBlankLines } from './blank-lines'

/** 编辑档位：light=画布文本框（片段能力做小），full=docs（含表格等结构）。 */
export type EditorTier = 'light' | 'full'

/**
 * 按档位装配扩展集。
 *
 * 装配差异收口于此函数：StarterKit 以 `false` 关停档位不需要的扩展，
 * 上层（内核组件、静态渲染、工具栏）只认 tier，不自行拼扩展。
 */
export function buildExtensions(tier: EditorTier): AnyExtension[] {
  const isFull = tier === 'full'

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      // —— 两档共有的片段级能力 ——
      bold: {},
      italic: {},
      strike: {},
      bulletList: {},
      orderedList: {},
      listItem: {},
      // —— 整框级字段，不进 Markdown 片段扩展（D1）——
      underline: false,
      // —— 仅 full 档需要的结构能力；light 关停以保持文本框做小 ——
      heading: isFull ? {} : false,
      blockquote: isFull ? {} : false,
      code: isFull ? {} : false,
      codeBlock: isFull ? {} : false,
      horizontalRule: isFull ? {} : false,
      // 链接：light 不接管（画布标注无链接交互，字面量直通保内容）；full 启用（md 原生往返）
      link: isFull ? {} : false,
    }),
    // `==高亮==`：两档共有；扩展自带 markdown parse/render 往返（== 进 == 出）
    Highlight,
    // 待办 `- [ ]` / `- [x]`（可嵌套）与文字颜色：两档都装，AI 写进文件的这两种语法不丢信息；
    // 按钮只在 full 档给（见 toolbarCapabilities）。TextColor 排在 StarterKit 之后，序列化时嵌在加粗/链接内层。
    TaskList,
    TaskItem.configure({ nested: true }),
    TextColor,
    // markdown 进出引擎：getMarkdown() / setContent(md) 的承载扩展。
    // breaks:true（GFM 硬换行）：单个 \n = 硬换行——画布既有 text 元素是含 \n 的纯文本，
    // 不开则单换行被按软换行折叠成空格（数据语义回退）。静态侧共用本装配，两侧一致。
    // marked：读回时空段落（用户留的空行）不被前一个块吞掉，见 blank-lines.ts。
    Markdown.configure({
      marked: markedWithBlankLines(),
      markedOptions: { gfm: true, breaks: true },
    }),
    // 粘贴入口：纯文本 / 无格式 HTML 按 Markdown 源码解析，粘进表格格子压平（见 markdown-paste.ts）
    MarkdownPaste,
    // 档位未覆盖语法的字面量直通（不支持的 md 永不丢内容，见 literal-fallback.ts）
    ...literalFallbackExtensions(tier),
  ]

  if (isFull) {
    // 表格：docs 用；格子单段、格内换行存 `<br>`、不可拖列宽（见 table-markdown.ts）。
    // 锚点节点（AnchorMarkerNode）批4 在此处追加
    extensions.push(...tableExtensions(), TableRow)
  }

  return extensions
}

/**
 * 档位对应的工具栏能力声明 —— 受控工具栏据此决定显示哪些按钮，
 * 与 buildExtensions 同源（同一 tier 判定），避免工具栏出现无对应扩展的死按钮。
 */
export interface TierToolbarCapabilities {
  bold: boolean
  italic: boolean
  strike: boolean
  bulletList: boolean
  orderedList: boolean
  highlight: boolean
  // full 专属
  taskList: boolean
  textColor: boolean
  heading: boolean
  blockquote: boolean
  codeBlock: boolean
  horizontalRule: boolean
  table: boolean
}

export function toolbarCapabilities(tier: EditorTier): TierToolbarCapabilities {
  const isFull = tier === 'full'
  return {
    bold: true,
    italic: true,
    strike: true,
    bulletList: true,
    orderedList: true,
    highlight: true,
    taskList: isFull,
    textColor: isFull,
    heading: isFull,
    blockquote: isFull,
    codeBlock: isFull,
    horizontalRule: isFull,
    table: isFull,
  }
}

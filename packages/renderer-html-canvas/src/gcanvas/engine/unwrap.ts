/**
 * unwrap.ts —— 拆壳翻译：完整网页 → shadow 注入物（设计依据：§1.7、契约 unwrap.ts）
 *
 * 拆壳是 viewer 的职责（定稿 §1.3）。用 parse5 真解析。
 *
 * 职责：
 *  1. 取正文：完整文档取 <body> 子树序列化为片段；无壳片段内容原样通过。
 *  2. 收样式：<head>/<body> 中所有 <style> 内容抽出（按文档序）；
 *     <link rel="stylesheet">（本地或外网）→ warnings（v1 不支持块内引外部样式表）。
 *  3. 替身 body 层 + 选择器翻译（Codex 评审 P1-1）：bodyHtml 外包 <div class="hc-block-body">，
 *     原 <body> 的 class/style 合并到替身（深色模式标记等不丢失）；
 *     选择器 :root / html / body 词法替换为 .hc-block-body（替身是普通元素，组合写法天然合法，
 *     如 body.dark → .hc-block-body.dark，规避 :host(.dark) 语法陷阱）。
 *     **无壳片段同样包替身层**（无属性可合并）——形态②片段块正是共享 css 的目标场景，
 *     替身必须恒存在，:root/body 翻译产物与 CSS 变量继承才有落点（集成裁定，LOGBOOK 06-07）。
 *  4. assets 路径重写：img[src|srcset]、source[src|srcset]、样式内 url(assets/...)（含 style 属性）
 *     中以 assets/ 开头的相对路径 → opts.assetUrl(rel)。
 *  5. 定位中和（与 :root/body 翻译同源——整页视角 CSS 注入画框后语义错位）：块内
 *     position: fixed → absolute，覆盖 <style>、共享 css、内联 style 三处；替身层附
 *     position:relative 基线（styles 打头）做包含块，令中和后的 absolute 相对本屏定位。
 *     fixed 相对视口、又因承接 camera 的世界层 transform 而以世界原点为参照，不治则逃出
 *     所在屏、压邻屏（吸顶/吸底/悬浮条尤甚）。sticky 不翻（恒受父元素约束、永不逃逸；
 *     无滚动视口下等同 relative 留原位，翻 absolute 反而脱流塌陷）。
 *
 * 另出口 prepareSharedCss：canvas.json css 数组的共享样式注入 shadow 前走与块内样式
 * 完全相同的处理（选择器翻译 + assets url 重写）——共享 css 以完整网页视角书写
 * （:root 变量、body 排版），原样注入 shadow 内永不命中；url(assets/...) 以页面为基准
 * 解析也会 404。单实现防漂移：渲染层不得自行写翻译逻辑。
 *
 * ⚖️ 裁定 4：选择器翻译用词法替换而非完整 CSS 解析（不引 postcss）。已知边界
 * （注释/字符串内字面量误替换）概率低后果轻（样式偏差非安全问题），试用暴露不够再升级。
 */

import { parse, parseFragment, serialize } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type Element = DefaultTreeAdapterMap['element']

export interface UnwrapResult {
  /** 注入 shadow root 的内容片段（已含 .hc-block-body 替身层，承接原 body 属性） */
  bodyHtml: string
  /**
   * 注入 shadow 的样式序列：替身层定位基线（.hc-block-body{position:relative}）打头，
   * 其后为块内 <style> 全文（已翻译，按文档序）。基线在前、作者样式在后可覆盖。
   * 基线随替身层一同产出，令所有注入 unwrap 输出的渲染点（HtmlBlockView）
   * 天然拿到定位包含块，无需各自补规则——避免漂移（同 prepareSharedCss 的单实现原则）。
   */
  styles: string[]
  /** 不可携带项提示（如外网/本地 <link rel=stylesheet>） */
  warnings: string[]
}

export interface UnwrapOptions {
  assetUrl: (rel: string) => string
}

function isElement(node: Node): node is Element {
  return 'tagName' in node && 'attrs' in node
}

function hasChildNodes(node: Node): node is ParentNode {
  return 'childNodes' in node
}

function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name.toLowerCase() === name)?.value
}

function setAttr(el: Element, name: string, value: string): void {
  const a = el.attrs.find((x) => x.name.toLowerCase() === name)
  if (a) a.value = value
  else el.attrs.push({ name, value })
}

/** 第一个匹配 tagName 的后代元素（深度优先），无则 undefined */
function findFirst(root: Node, tag: string): Element | undefined {
  if (!hasChildNodes(root)) return undefined
  for (const child of root.childNodes) {
    if (isElement(child)) {
      if (child.tagName.toLowerCase() === tag) return child
      const inner = findFirst(child, tag)
      if (inner) return inner
    }
  }
  return undefined
}

/**
 * assets/ 开头的安全相对路径（无 ../、无反斜杠、无空段）才重写；其余原样保留。
 * 导出供 clipboard.ts 跨项目复制时识别块内本地 asset 引用——**识别口径必须与渲染期改写
 * （rewriteUrl/rewriteCssUrls）完全同源**，否则会出现"复制时收了某引用但渲染期不改写、或反之"的漂移。
 */
export function isAssetsRel(url: string): boolean {
  if (!url.startsWith('assets/')) return false
  if (url.includes('\\')) return false
  return url.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

/** 重写单个 URL：assets/ 相对路径 → assetUrl(rel)；否则原样 */
function rewriteUrl(url: string, opts: UnwrapOptions): string {
  const trimmed = url.trim()
  return isAssetsRel(trimmed) ? opts.assetUrl(trimmed) : url
}

/** 重写 srcset（逗号分隔的「URL 描述符」列表）中各 URL 的 assets/ 路径 */
function rewriteSrcset(srcset: string, opts: UnwrapOptions): string {
  return srcset
    .split(',')
    .map((part) => {
      const seg = part.trim()
      if (seg === '') return part
      const sp = seg.indexOf(' ')
      const url = sp === -1 ? seg : seg.slice(0, sp)
      const descriptor = sp === -1 ? '' : seg.slice(sp)
      return rewriteUrl(url, opts) + descriptor
    })
    .join(', ')
}

/**
 * CSS 文本内 url(assets/...) 重写（含 style 属性值）。
 * 匹配 url( 可选引号 路径 可选引号 )，仅对 assets/ 相对路径调用 assetUrl。
 */
function rewriteCssUrls(css: string, opts: UnwrapOptions): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote: string, path: string) => {
    const trimmed = path.trim()
    if (!isAssetsRel(trimmed)) return whole
    return `url(${quote}${opts.assetUrl(trimmed)}${quote})`
  })
}

/**
 * 选择器词法翻译：:root / html / body → .hc-block-body（裁定 4）。
 * 词法层做整词替换，避免误伤 `body` 子串（如类名 .somebody、属性 [data-body]）：
 * - :root 直接替换
 * - 作为独立选择器 token 的 html / body（前为分隔符/起始，后为分隔符/组合符/结束）才替换
 */
function translateSelectors(css: string): string {
  let out = css.replace(/:root\b/gi, '.hc-block-body')
  // html / body 作为元素选择器 token：用边界断言避免误伤标识符内的 body/html 子串
  out = out.replace(/(^|[\s,>+~(])(html|body)(?=[\s,>+~){:.#\[]|$)/gi, (_m, pre: string) => {
    return `${pre}.hc-block-body`
  })
  return out
}

/**
 * 替身层定位基线：作 absolute（含中和后的原 fixed、及块内无定位祖先的 absolute）的块级包含块。
 * 无它则这些 absolute 以最近 transform 祖先——承接 camera 的 .hc-world（0×0 在世界原点）——为
 * 参照，逃出所在屏。position:relative 无偏移不改布局、z-index:auto 不建层叠上下文，代价极低。
 * 随 unwrap 输出打头（作者样式在后可覆盖），令每个注入点天然得到包含块（见 UnwrapResult.styles）。
 */
const BLOCK_BODY_BASE_CSS = '.hc-block-body { position: relative }'

/**
 * 定位中和：position: fixed → position: absolute（裁定 4 同款词法翻译，不引 CSS 解析器）。
 *
 * 为什么翻 fixed：fixed 相对视口（或最近 transform 祖先）定位。块渲染在承接 camera transform
 * 的 .hc-world 内，fixed 元素以世界层原点为参照——逃出所在屏、甚至压到邻屏。翻成 absolute 后
 * 相对替身层 .hc-block-body 定位（BLOCK_BODY_BASE_CSS 兜底做包含块），从而留在本屏内。
 * 语义降级：画布块全展开、无滚动视口，原 fixed bottom:0 落在展开页底部而非"视口悬浮"——
 * 无限画布下 fixed 的合理落点。
 *
 * 为什么不翻 sticky：sticky 恒受其包含块（父元素）约束、永不逃出；无滚动视口下等同 relative
 * 留在原位。翻成 absolute 反而脱流塌陷、内容上顶重叠；块内若有作者自建滚动容器，sticky 仍在其中生效。
 *
 * 精准命中：仅整词属性 position（左界为起始/分隔符，排除 background-position 等以 -position
 * 收尾的属性）的 fixed 值才替换；保留 !important 等尾串；不碰 background-attachment: fixed
 * 之类同值异属声明。裁定 4 已知边界（注释/字符串内字面量）概率低后果轻，与选择器翻译同担。
 */
function neutralizeFixedPosition(css: string): string {
  return css.replace(/(^|[;{\s])(position\s*:\s*)fixed\b/gi, (_m, pre: string, prop: string) => {
    return `${pre}${prop}absolute`
  })
}

/** 遍历元素树，重写 img/source 的 src/srcset 与所有 style 属性内的 url() */
function rewriteAssetsInTree(node: Node, opts: UnwrapOptions): void {
  if (!hasChildNodes(node)) return
  for (const child of node.childNodes) {
    if (!isElement(child)) continue
    const tag = child.tagName.toLowerCase()
    if (tag === 'img' || tag === 'source') {
      const src = getAttr(child, 'src')
      if (src !== undefined) setAttr(child, 'src', rewriteUrl(src, opts))
      const srcset = getAttr(child, 'srcset')
      if (srcset !== undefined) setAttr(child, 'srcset', rewriteSrcset(srcset, opts))
    }
    const style = getAttr(child, 'style')
    if (style !== undefined) setAttr(child, 'style', rewriteCssUrls(neutralizeFixedPosition(style), opts))
    rewriteAssetsInTree(child, opts)
    if ('content' in child && (child as { content?: Node }).content) {
      rewriteAssetsInTree((child as { content: Node }).content, opts)
    }
  }
}

/** 收集 styles（翻译 + asset 重写）与 link warnings；按文档序下钻 head 与 body */
function collectStyles(node: Node, opts: UnwrapOptions, styles: string[], warnings: string[]): void {
  if (!hasChildNodes(node)) return
  for (const child of node.childNodes) {
    if (!isElement(child)) continue
    const tag = child.tagName.toLowerCase()
    if (tag === 'style') {
      let text = ''
      for (const c of child.childNodes) {
        if (c.nodeName === '#text') text += (c as unknown as { value: string }).value
      }
      styles.push(rewriteCssUrls(neutralizeFixedPosition(translateSelectors(text)), opts))
    } else if (tag === 'link') {
      const rel = getAttr(child, 'rel')
      if (rel && rel.toLowerCase().split(/\s+/).includes('stylesheet')) {
        const href = getAttr(child, 'href') ?? '(无 href)'
        warnings.push(`不支持块内 <link rel="stylesheet">（${href}）——共享样式请走 canvas.json 的 css 数组`)
      }
      // style 节点不会嵌套，无需对 style 内部再下钻
    } else {
      collectStyles(child, opts, styles, warnings)
    }
  }
}

/**
 * 共享 css（canvas.json css 数组）注入 shadow 前的统一处理：
 * 选择器翻译（:root/html/body → .hc-block-body）+ 定位中和（fixed → absolute）+ url(assets/...) 重写。
 * 与块内 <style> 的处理完全同源（同三个内部函数），杜绝两套翻译逻辑漂移。
 */
export function prepareSharedCss(css: string, opts: UnwrapOptions): string {
  return rewriteCssUrls(neutralizeFixedPosition(translateSelectors(css)), opts)
}

export function unwrapBlock(html: string, opts: UnwrapOptions): UnwrapResult {
  // 替身层定位基线打头：作者块内样式随后 push，可覆盖（见 UnwrapResult.styles 契约）
  const styles: string[] = [BLOCK_BODY_BASE_CSS]
  const warnings: string[] = []

  const isFullDoc = /<!doctype|<html[\s>]|<body[\s>]|<head[\s>]/i.test(html)

  if (!isFullDoc) {
    // 无壳片段（形态②常见）：内容原样取正文，仅做 asset 重写；片段内 <style> 也收集翻译。
    // 替身层恒包裹（无原 body 属性可合并）：共享 css 的 :root/body 翻译产物需要落点（见文件头 3.）
    const frag = parseFragment(html)
    collectStyles(frag, opts, styles, warnings)
    // 收集后从片段里剔除 <style>（样式归 styles 数组统一注入，不重复留在 bodyHtml）
    stripStyleNodes(frag)
    rewriteAssetsInTree(frag, opts)
    return { bodyHtml: `<div class="hc-block-body">${serialize(frag)}</div>`, styles, warnings }
  }

  // 完整文档：分别从 head 与 body 收样式（按 head→body 文档序）
  const doc = parse(html)
  const head = findFirst(doc, 'head')
  const body = findFirst(doc, 'body')
  if (head) collectStyles(head, opts, styles, warnings)
  if (body) collectStyles(body, opts, styles, warnings)

  // 替身层：用原 body 的 class/style 建一个 .hc-block-body 包裹 body 子树
  const bodyClass = body ? getAttr(body, 'class') : undefined
  const bodyStyle = body ? getAttr(body, 'style') : undefined
  const className = ['hc-block-body', bodyClass].filter(Boolean).join(' ')
  const styleAttr = bodyStyle
    ? ` style="${escapeAttr(rewriteCssUrls(neutralizeFixedPosition(bodyStyle), opts))}"`
    : ''

  // body 子树：剔除 <style>（已收集），重写其余 asset，序列化为内层 HTML
  let inner = ''
  if (body) {
    stripStyleNodes(body)
    rewriteAssetsInTree(body, opts)
    inner = serialize(body)
  }

  const bodyHtml = `<div class="${escapeAttr(className)}"${styleAttr}>${inner}</div>`
  return { bodyHtml, styles, warnings }
}

/** 从子树移除所有 <style> 元素（样式已被 collectStyles 统一抽走，避免重复注入） */
function stripStyleNodes(node: Node): void {
  if (!hasChildNodes(node)) return
  node.childNodes = node.childNodes.filter((c) => !(isElement(c) && c.tagName.toLowerCase() === 'style'))
  for (const child of node.childNodes) {
    stripStyleNodes(child)
    if (isElement(child) && 'content' in child && (child as { content?: Node }).content) {
      stripStyleNodes((child as { content: Node }).content)
    }
  }
}

/** 属性值转义（用于手工拼 .hc-block-body 替身层的 class/style 属性） */
function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * sanitize.ts —— 主动内容强制剥离（设计依据：§1.7、契约 sanitize.ts）
 *
 * 用 parse5 真解析（非正则裸串）：畸形 HTML、属性内嵌引号都会绕过正则，
 * 且 parse5 是 WHATWG 标准算法，对畸形输入容错与浏览器一致（块文件来自任意外部导入）。
 *
 * 剥离清单（§1.7 八类 + CSS 两类，已经 Codex 评审 P0-5 扩大、用户确认）：
 *  1. <script>（一切 type）—— 整元素移除
 *  2. on* 内联事件属性 —— 移除该属性
 *  3. href/src/action/formaction 属性值为 javascript: 协议 —— 移除该属性
 *  4. <iframe>/<frame>/<object>/<embed> —— 整元素移除（同源主动内容执行面）
 *  5. <base> —— 整元素移除（篡改链接基准）
 *  6. <meta http-equiv="refresh"> —— 整元素移除（自动跳转）
 *  7. CSS（<style> 文本与 style 属性）内 @import —— 一律剥除
 *  8. CSS 外网 url(http…) —— 剥除
 *
 * removed 为「人话描述」数组，UI 提示用（同类多次出现各记一条，便于定位）。
 * 畸形 HTML 不抛错（parse5 容错）。
 */

import { parse, parseFragment, serialize } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
type ParentNode = DefaultTreeAdapterMap['parentNode']
type ChildNode = DefaultTreeAdapterMap['childNode']
type Element = DefaultTreeAdapterMap['element']

export interface SanitizeResult {
  html: string
  removed: string[]
}

/** 需整体移除的危险标签名（小写） */
const DANGEROUS_TAGS = new Set(['script', 'iframe', 'frame', 'object', 'embed', 'base'])

/**
 * URL 属性按用途分两类（data: 协议按场景白名单，不误杀块内合法内容）：
 * - 导航类（点击/提交即按文档语义解析）：协议白名单 http/https/mailto/tel/相对路径/#锚点；
 *   data:/javascript:/vbscript: 等一律剥——data:text/html 可承载完整可执行文档。
 * - 媒体类（src/srcset，按资源解码）：保留 `data:image/*`（块内内联图合法常见），
 *   剥 javascript:/vbscript: 与其余 data: 子类型。
 * （xlink:href 为 SVG 老写法 href 等价物，归导航类同一标准。）
 */
const NAV_URL_ATTRS = new Set(['href', 'action', 'formaction', 'xlink:href'])
const MEDIA_URL_ATTRS = new Set(['src', 'srcset'])

/** 导航类协议白名单（无协议 = 相对路径/#锚点，天然安全） */
const NAV_SCHEME_ALLOW = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * SVG 动画标签与其取值属性：动画本身保留（不影响渲染就不删——2026-06-07 用户裁定：
 * 现阶段威胁模型不含代码植入，过滤标准与其他元素一致），仅当取值属性携带
 * javascript: 协议时剥该属性（与 URL_ATTRS 同一条标准——动画可把这些值写进 href）。
 */
const SVG_ANIM_TAGS = new Set(['animate', 'set', 'animatetransform', 'animatemotion'])
const ANIM_VALUE_ATTRS = new Set(['to', 'from', 'by', 'values'])

/** ASCII 控制字符 + 空白（浏览器解析协议前会剥除这些）。用 unicode 转义避免源码内嵌裸控制字符 */
const CONTROL_AND_SPACE = /[\x00-\x20]/g

function isElement(node: Node): node is Element {
  return 'tagName' in node && 'attrs' in node
}

function hasChildNodes(node: Node): node is ParentNode {
  return 'childNodes' in node
}

/** 取属性值（小写名匹配；找不到返回 undefined） */
function getAttr(el: Element, name: string): string | undefined {
  const a = el.attrs.find((x) => x.name === name)
  return a?.value
}

/** 去控制字符/空白后的小写形态（浏览器解析协议前会剥这些，杜绝 "java\tscript:" 绕过） */
function strippedLower(value: string): string {
  return value.replace(CONTROL_AND_SPACE, '').toLowerCase()
}

/** value 去前导空白/控制字符后以 javascript: 开头（大小写不敏感） */
function isJavascriptUrl(value: string): boolean {
  return strippedLower(value).startsWith('javascript:')
}

/**
 * 提取 URL 协议（去控制字符后按 RFC3986 scheme 形态匹配）；null = 无协议（相对路径/#锚点）。
 * "assets/a:b.png" 这类路径中段的冒号不会误判（scheme 必须从串首起且不含 /）。
 */
function schemeOf(value: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/.exec(strippedLower(value))
  return m ? m[1]! : null
}

/** 导航类 URL 安全：相对路径/#锚点（无协议）或白名单协议 */
function isSafeNavUrl(value: string): boolean {
  const scheme = schemeOf(value)
  return scheme === null || NAV_SCHEME_ALLOW.has(scheme)
}

/** data: URL 是否为 image/* 子类型（媒体类与 CSS url() 的 data: 白名单） */
function isDataImageUrl(value: string): boolean {
  return /^data:image\//.test(strippedLower(value))
}

/**
 * 媒体类 URL 安全（src / srcset 单个候选）：
 * 剥可执行协议（javascript/vbscript）与非 image/* 的 data:；其余（http/相对路径等）放行。
 */
function isSafeMediaUrl(value: string): boolean {
  const scheme = schemeOf(value)
  if (scheme === null) return true
  if (scheme === 'javascript' || scheme === 'vbscript') return false
  if (scheme === 'data') return isDataImageUrl(value)
  return true
}

/**
 * srcset 全候选安全判定：srcset = "url [描述符], url [描述符], …"——逐候选取首段 URL 判
 * isSafeMediaUrl；任一候选不安全 → 整属性剥（不做部分裁剪，保持简单且不产生畸形 srcset）。
 */
function isSafeSrcset(value: string): boolean {
  return value
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '')
    .every((candidate) => {
      const url = candidate.split(/\s+/)[0] ?? ''
      return isSafeMediaUrl(url)
    })
}

/** SVG 动画取值（to/from/by/values 段）安全：剥可执行协议与非 image 的 data:（值多为数值/颜色，无协议即放行） */
function isSafeAnimValue(value: string): boolean {
  return isSafeMediaUrl(value)
}

/**
 * 清理一段 CSS 文本：剥 @import 与外网 url(http…)。
 * 用于 <style> 文本与 style 属性值。返回清洗后的 CSS，并把发生的剥离记入 removed。
 * 词法层处理（不引 postcss，§1.7 裁定 4 同精神）：@import 整条规则删除；
 * url(...) 中以 http/https/协议相对 // 开头者替换为空 url()（仅动该 url 函数，不破坏其余声明）。
 */
function cleanCss(css: string, where: string, removed: string[]): string {
  let out = css
  // @import ... ;（含 @import url(...) 与 @import "..."）整条删除
  if (/@import\b/i.test(out)) {
    out = out.replace(/@import\b[^;]*;?/gi, '')
    removed.push(`${where} 内的 @import 规则`)
  }
  // 外网 url(http://…) / url(https://…) / url(//…) —— 替换为空 url()
  const externalUrl = /url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi
  if (externalUrl.test(out)) {
    out = out.replace(externalUrl, 'url()')
    removed.push(`${where} 内的外网 url() 引用`)
  }
  // 危险协议 url()：url(javascript:…)/url(vbscript:…) 与非 image/* 的 url(data:…) 置空；
  // url(data:image/*) 保留（与现行块渲染兼容：内联图背景合法常见）
  const anyUrl = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi
  let strippedDangerous = false
  out = out.replace(anyUrl, (full, _q: string, inner: string) => {
    const scheme = schemeOf(inner)
    if (scheme === 'javascript' || scheme === 'vbscript' || (scheme === 'data' && !isDataImageUrl(inner))) {
      strippedDangerous = true
      return 'url()'
    }
    return full
  })
  if (strippedDangerous) {
    removed.push(`${where} 内的危险协议 url() 引用`)
  }
  return out
}

/**
 * 共享 css 文件（canvas.json css 数组）专用出口：与块内样式完全同一套 CSS 清洗
 * （@import / 外网 url() 剥除，Codex 代码评审 P0-2——共享样式不得走免检通道）。
 * where 为人话来源标识（如「共享样式 styles/x.css」），removed 供 UI 提示条。
 */
export function sanitizeCss(css: string, where: string): { css: string; removed: string[] } {
  const removed: string[] = []
  const out = cleanCss(css, where, removed)
  return { css: out, removed }
}

export function sanitizeHtml(html: string): SanitizeResult {
  const removed: string[] = []
  // 完整文档（含 <html>/<body>/DOCTYPE）走 parse，保壳序列化；无壳片段走 parseFragment。
  // sanitize 不拆壳（拆壳是 unwrap 职责），仅清洗后原样序列化回去。
  const isFullDoc = /<!doctype|<html[\s>]|<body[\s>]|<head[\s>]/i.test(html)
  const root: Node = isFullDoc ? parse(html) : parseFragment(html)

  walk(root, removed)

  const out = serialize(root as ParentNode)
  return { html: out, removed }
}

/** 深度优先遍历：先在父节点层过滤需整体移除的子元素，再处理保留元素的属性与下钻 */
function walk(node: Node, removed: string[]): void {
  if (!hasChildNodes(node)) return

  // 过滤需整体移除的子节点（危险标签、meta refresh）；保留的留待递归
  const kept: ChildNode[] = []
  for (const child of node.childNodes) {
    if (isElement(child)) {
      const tag = child.tagName.toLowerCase()

      if (DANGEROUS_TAGS.has(tag)) {
        removed.push(describeTagRemoval(tag))
        continue // 整元素丢弃（含其子树）
      }
      if (tag === 'meta') {
        const httpEquiv = getAttr(child, 'http-equiv')
        if (httpEquiv && httpEquiv.toLowerCase() === 'refresh') {
          removed.push('<meta http-equiv="refresh">（自动跳转）')
          continue
        }
      }
      if (tag === 'style') {
        cleanStyleElement(child, removed) // <style> 文本节点 CSS 清洗
      }
      sanitizeAttrs(child, removed)
    }
    kept.push(child)
  }
  node.childNodes = kept

  // 递归下钻保留的子节点；<template> 的内容在 content 文档片段里，单独下钻
  for (const child of node.childNodes) {
    walk(child, removed)
    if (isElement(child) && 'content' in child && child.content) {
      walk((child as { content: Node }).content, removed)
    }
  }
}

/** 清理单个元素的属性：on* 事件、URL 协议白名单（导航/媒体分型）、style 属性内 CSS */
function sanitizeAttrs(el: Element, removed: string[]): void {
  const tag = el.tagName.toLowerCase()
  const nextAttrs: Element['attrs'] = []
  for (const attr of el.attrs) {
    const name = attr.name.toLowerCase()

    if (name.startsWith('on')) {
      removed.push(`<${tag}> 的内联事件属性 ${attr.name}`)
      continue // 丢弃 on* 事件属性
    }
    // 导航类：协议白名单（http/https/mailto/tel/相对路径/#锚点）；data:/javascript:/vbscript: 等剥
    if (NAV_URL_ATTRS.has(name) && !isSafeNavUrl(attr.value)) {
      removed.push(`<${tag}> 的 ${attr.name}（非白名单协议 ${schemeOf(attr.value) ?? '?'}：）`)
      continue
    }
    // 媒体类：javascript:/vbscript:/非 image 的 data: 剥；data:image/* 保留（块内内联图合法）
    if (MEDIA_URL_ATTRS.has(name)) {
      const safe = name === 'srcset' ? isSafeSrcset(attr.value) : isSafeMediaUrl(attr.value)
      if (!safe) {
        removed.push(`<${tag}> 的 ${attr.name}（危险协议或非 image 的 data:）`)
        continue
      }
    }
    // SVG 动画的取值属性：values 为分号分隔列表，任一段命中危险协议即剥该属性（动画元素保留）。
    // 数值/颜色等非 URL 取值无协议，天然放行（不误杀正常动画）。
    if (SVG_ANIM_TAGS.has(tag) && ANIM_VALUE_ATTRS.has(name)) {
      const segments = name === 'values' ? attr.value.split(';') : [attr.value]
      if (segments.some((seg) => !isSafeAnimValue(seg))) {
        removed.push(`<${tag}> 的 ${attr.name}（动画取值含危险协议）`)
        continue
      }
    }
    if (name === 'style') {
      attr.value = cleanCss(attr.value, `<${tag}> style 属性`, removed)
    }
    nextAttrs.push(attr)
  }
  el.attrs = nextAttrs
}

/** <style> 元素文本节点 CSS 清洗 */
function cleanStyleElement(el: Element, removed: string[]): void {
  for (const child of el.childNodes) {
    if (child.nodeName === '#text') {
      const text = child as { value: string }
      text.value = cleanCss(text.value, '<style>', removed)
    }
  }
}

function describeTagRemoval(tag: string): string {
  switch (tag) {
    case 'script':
      return '<script>（脚本）'
    case 'iframe':
      return '<iframe>'
    case 'frame':
      return '<frame>'
    case 'object':
      return '<object>'
    case 'embed':
      return '<embed>'
    case 'base':
      return '<base>（篡改链接基准）'
    default:
      return `<${tag}>`
  }
}

/**
 * 包围盒收集 —— fitToContent 的输入（从 html_canvas viewport.ts + bounds.ts 精简内聚）
 *
 * camera.fitToContent 只接受 Rect[]，「怎么把每类元素折算成 Rect」是调用方职责：
 * - shape / image / frame：直接用 x/y/w/h
 * - arrow：两端点 AABB + 固定外扩（水平/垂直箭头零面积需补正）
 * - html / text 无 measured：用占位预估（与渲染占位一致）
 *
 * 估错只影响 Cmd+0 / 初始 fit 的余量，无正确性风险。
 */
import type { Rect } from './camera'
import type { CanvasElement, TextElement, HtmlElement } from './schema'

/** html 无 measured 时的占位预估（与 HtmlBlock PLACEHOLDER 一致） */
const HTML_PLACEHOLDER_W = 360
const HTML_PLACEHOLDER_H = 240

/** 箭头包围盒外扩余量（线宽 + marker + 标签），保证零面积箭头也有正面积盒 */
const ARROW_PAD = 16

/** 文本宽度粗估：每字约 0.6×fontSize，单行 */
function estimateTextBounds(el: TextElement): Rect {
  const lineHeight = el.fontSize * 1.5
  const charCount = [...el.text].length
  const w = el.width ?? Math.max(el.fontSize, charCount * el.fontSize * 0.6)
  const h = el.measured?.h ?? lineHeight
  return { x: el.x, y: el.y, w, h }
}

/** html 包围盒：有 measured 用之，否则占位预估 */
function htmlBounds(el: HtmlElement): Rect {
  if (el.measured) return { x: el.x, y: el.y, w: el.measured.w, h: el.measured.h }
  return { x: el.x, y: el.y, w: HTML_PLACEHOLDER_W, h: HTML_PLACEHOLDER_H }
}

/** 单个元素折算为世界坐标 Rect（用于 fit） */
function boundsForFit(el: CanvasElement): Rect {
  switch (el.type) {
    case 'arrow': {
      const x = Math.min(el.x1, el.x2)
      const y = Math.min(el.y1, el.y2)
      const w = Math.abs(el.x2 - el.x1)
      const h = Math.abs(el.y2 - el.y1)
      return { x: x - ARROW_PAD, y: y - ARROW_PAD, w: w + ARROW_PAD * 2, h: h + ARROW_PAD * 2 }
    }
    case 'text':
      return estimateTextBounds(el)
    case 'html':
      return htmlBounds(el)
    case 'shape':
    case 'image':
    case 'frame':
      return { x: el.x, y: el.y, w: el.w, h: el.h }
  }
}

/** 收集全文档元素的世界坐标包围盒（供 fitToContent） */
export function collectBounds(elements: CanvasElement[]): Rect[] {
  return elements.map(boundsForFit)
}

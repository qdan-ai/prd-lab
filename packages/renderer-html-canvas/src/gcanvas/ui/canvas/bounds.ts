/**
 * fitToContent 的包围盒收集（设计 §1.6 / §2.3）
 *
 * camera.fitToContent 只接受 Rect[]，"怎么把每类元素折算成 Rect"是调用方职责：
 * - 可量元素（shape/image/frame、有 measured 的 html）→ elementBounds
 * - arrow → resolveArrowBounds（解析后渲染盒，绑定端点已贴目标边、随目标跟随；含线宽/端头/标签外扩）
 * - html 无 measured → 360×240 占位预估（与 HtmlBlockView 占位默认一致）
 * - text 无 w/h → 按 fontSize 估行高、宽按字数估
 *
 * 估错只影响 Cmd+0 余量，无正确性风险（设计 §1.6 明示）。
 */
import type { CanvasDoc, CanvasElement, TextElement } from '../../engine/schema'
import { type Rect, elementBounds } from '../../engine/viewport'
import { resolveArrowBounds } from '../../engine/arrow-geometry'

/** html 无 measured 时的占位预估（与 HtmlBlockView PLACEHOLDER 一致） */
const HTML_PLACEHOLDER_W = 360
const HTML_PLACEHOLDER_H = 240

/** 文本宽度粗估：每字约 0.6×fontSize（中英文混排取中庸值），单行 */
function estimateTextBounds(el: TextElement): Rect {
  const lineHeight = el.fontSize * 1.5
  const charCount = [...el.text].length
  const w = Math.max(el.fontSize, charCount * el.fontSize * 0.6)
  return { x: el.x, y: el.y, w, h: lineHeight }
}

/** 单个元素折算为世界坐标 Rect（用于 fit）；arrow 经 resolver 取解析后盒（绑定端已贴目标边） */
function boundsForFit(el: CanvasElement, doc: CanvasDoc): Rect {
  if (el.type === 'arrow') {
    return resolveArrowBounds(doc, el)
  }
  if (el.type === 'text') {
    return estimateTextBounds(el)
  }
  if (el.type === 'html') {
    // 有 measured 走 elementBounds；无 measured 用占位预估
    const b = elementBounds(el)
    if (b) return b
    return { x: el.x, y: el.y, w: HTML_PLACEHOLDER_W, h: HTML_PLACEHOLDER_H }
  }
  // shape / image / frame：elementBounds 必返回非 null
  return elementBounds(el) ?? { x: el.x, y: el.y, w: 0, h: 0 }
}

/** 收集全文档元素的世界坐标包围盒（供 fitToContent） */
export function collectBounds(doc: CanvasDoc): Rect[] {
  return doc.elements.map((el) => boundsForFit(el, doc))
}

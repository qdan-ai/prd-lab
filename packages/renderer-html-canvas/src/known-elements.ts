/**
 * 元素分类 + 兜底（查看器自有）
 *
 * 逐字件（引擎几何、箭头解析、包围盒、渲染器）只处理符合 G-canvas schema 的元素——G-canvas 自己
 * 加载画板时先过 validateCanvasDoc，渲染代码不再防御缺字段。查看器收到的画板可能来自更新或更旧的
 * G-canvas，所以逐元素分三类：
 * - rendered：已接入的类型且通过 G-canvas 单元素校验 → 交给逐字件渲染
 * - unknown-type：查看器尚未接入的类型（上游新类型）→ 占位卡，提示查看器需更新
 * - invalid：已知类型但数据不符合 G-canvas 格式（如缺少端点的箭头）→ 占位卡，写明第一条校验错误
 * 后两类按占位盒计入框选全部，整块画板照常显示。
 */
import { BOARD_FORMAT, validateCanvasDoc, type CanvasDoc, type CanvasElement, type ElementType } from './gcanvas/engine/schema'
import type { Rect } from './gcanvas/engine/viewport'
import { collectBounds } from './gcanvas/ui/canvas/bounds'

/**
 * 查看器已接入渲染的元素类型。`satisfies Record<ElementType, true>`：上游 schema 增删类型后
 * 跑 gcanvas-sync sync，这里会类型检查报错，提醒在 ElementLayer 改写件接入新渲染器。
 */
export const RENDERED_TYPES = {
  html: true,
  shape: true,
  text: true,
  image: true,
  arrow: true,
  frame: true,
  note: true,
} as const satisfies Record<ElementType, true>

/** 占位卡读取的字段（元素形态未知，逐个按需取） */
export interface UnknownElement {
  id?: unknown
  type?: unknown
  x?: unknown
  y?: unknown
  w?: unknown
  h?: unknown
}

export type ElementStatus =
  | { kind: 'rendered'; el: CanvasElement }
  | { kind: 'unknown-type'; type: string }
  | { kind: 'invalid'; type: string; reason: string }

/** 占位卡在元素缺 w/h 时的尺寸 */
export const UNKNOWN_PLACEHOLDER_W = 320
export const UNKNOWN_PLACEHOLDER_H = 160

const statusCache = new WeakMap<object, ElementStatus>()

/**
 * 单元素分类。合法性用 G-canvas validateCanvasDoc 判定，只看元素自身：去掉 parent 再单独校验，
 * 跨元素约束（parent 指向、frame 先于子元素、id 唯一）不影响能否绘制，不计入。
 */
export function elementStatus(el: unknown): ElementStatus {
  if (typeof el !== 'object' || el === null) return { kind: 'invalid', type: typeof el, reason: '元素必须是对象' }
  const hit = statusCache.get(el)
  if (hit) return hit
  const status = classify(el as Record<string, unknown>)
  statusCache.set(el, status)
  return status
}

function classify(el: Record<string, unknown>): ElementStatus {
  const type = el['type']
  if (typeof type !== 'string' || !Object.hasOwn(RENDERED_TYPES, type)) {
    return { kind: 'unknown-type', type: String(type) }
  }
  const { parent: _parent, ...intrinsic } = el
  const { errors } = validateCanvasDoc({ title: 'element', format: BOARD_FORMAT, elements: [intrinsic] })
  if (errors.length === 0) return { kind: 'rendered', el: el as unknown as CanvasElement }
  return { kind: 'invalid', type, reason: errors[0]!.replace(/^elements\[0\](?: \(id=[^)]*\))? /, '') }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 占位卡的世界坐标盒：有 x/y/w/h 用之，缺的位置取 0、缺的尺寸取占位默认 */
export function placeholderRect(el: UnknownElement): Rect {
  return {
    x: finite(el.x) ? el.x : 0,
    y: finite(el.y) ? el.y : 0,
    w: finite(el.w) && el.w > 0 ? el.w : UNKNOWN_PLACEHOLDER_W,
    h: finite(el.h) && el.h > 0 ? el.h : UNKNOWN_PLACEHOLDER_H,
  }
}

/** 只含 rendered 元素的文档（交给逐字件做箭头解析与包围盒）；全部可渲染时原样返回 */
export function renderedDoc(doc: CanvasDoc): CanvasDoc {
  const elements = doc.elements.filter((el) => elementStatus(el).kind === 'rendered')
  return elements.length === doc.elements.length ? doc : { ...doc, elements }
}

/** 框选全部的包围盒：可渲染元素走 G-canvas collectBounds，其余按占位盒计入 */
export function collectViewerBounds(doc: CanvasDoc): Rect[] {
  const rects = collectBounds(renderedDoc(doc))
  for (const el of doc.elements) {
    if (elementStatus(el).kind !== 'rendered') rects.push(placeholderRect((el ?? {}) as UnknownElement))
  }
  return rects
}

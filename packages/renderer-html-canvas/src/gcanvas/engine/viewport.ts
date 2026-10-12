/**
 * 视口几何纯函数 —— 视口剔除（culling）的地基（设计依据：v1 设计定稿 §2.4）
 *
 * 引擎层纪律：纯 TS、无框架、无副作用，全部可单元测试。
 * 这里只提供"求包围盒 + 矩形相交 + 按比例外扩"三类几何原语；
 * 可见集的迟滞判定（外扩 ~50% 标可见、~100% 才标不可见）交由调用方组合，
 * 本模块只保证这些原语本身正确。
 */

import type { ArrowElement, CanvasElement } from './schema'

/** 世界坐标轴对齐矩形（px）。x/y 为左上角，w/h 为宽高（约定非负） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 两矩形是否相交。
 *
 * 语义选定：**边界相切算"不相交"**（采用半开区间 [x, x+w)）。
 * 理由：视口剔除场景下，恰好贴着视口边缘外侧、零像素重叠的元素无需挂载，
 * 算作不相交可减少边缘抖动时的无谓挂载；且半开区间不会把"零面积接触"误判为可见。
 * 因此采用严格不等号：只要任一轴上没有正向重叠即判不相交。
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  )
}

/**
 * outer 是否完全包含 inner —— 框选「完全框住才选中」的判定原语（设计 D7）。
 *
 * 语义选定：**闭区间，边界相切算包含**——inner 的边恰好贴在 outer 边上仍判包含。
 * 与 rectsIntersect 的半开区间对称定义：相交判定把零重叠排除在外（视口边缘抖动不误挂载），
 * 包含判定把零距离贴边纳入在内（框选恰好贴住元素边时不因 1px 抖动致选中态闪烁）。
 * 零面积矩形（如水平/垂直箭头的线几何盒）按同一规则成立：线段落在框内（含边界）即包含。
 */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

/**
 * 以中心不变的方式按比例外扩矩形（用于视口缓冲带）。
 * factor 为每侧外扩的比例：factor=0.5 表示宽高各放大到 (1 + 2*0.5)=2 倍，
 * 即左右各外扩半个宽、上下各外扩半个高 —— 对应 §2.4 的"视口外扩 ~50%"。
 * factor=1.0 对应"外扩 ~100%"（宽高变为原来的 3 倍）。
 * 中心点 (x + w/2, y + h/2) 在外扩前后保持不变；factor=0 时原样返回。
 * 负 factor（内缩）不在 §2.4 用例内，但函数对其同样按公式成立（中心不变）。
 */
export function expandRect(r: Rect, factor: number): Rect {
  const dw = r.w * factor
  const dh = r.h * factor
  return {
    x: r.x - dw,
    y: r.y - dh,
    w: r.w + dw * 2,
    h: r.h + dh * 2,
  }
}

/**
 * 从 schema 元素求世界坐标包围盒。
 *
 * 各类型取值规则（设计 §1.2 / §2.4）：
 * - shape / image / frame：直接用 x/y/w/h。
 * - arrow：用 points[] 全部点求轴对齐包围盒（线本身无宽高，标签不计入）。
 * - html / text：尺寸为自然排版尺寸，仅在首渲实测写回 measured 后才可知；
 *   有 measured 用 x/y + measured.w/h，**无 measured 返回 null**（调用方需按占位/预估处理）。
 *
 * 返回 null 表示"此元素尺寸暂不可几何确定"，而非出错。
 */
export function elementBounds(el: CanvasElement): Rect | null {
  switch (el.type) {
    case 'shape':
    case 'image':
    case 'frame':
      return { x: el.x, y: el.y, w: el.w, h: el.h }
    case 'arrow': {
      // 真实线几何 AABB（无外扩）——框选取盒用
      return pointsAABB(el.points)
    }
    case 'html':
    case 'text':
      // 与 html 同源：实测缓存在位才几何可确定（text 首渲由 TextView 写回 measured）
      if (!el.measured) return null
      return { x: el.x, y: el.y, w: el.measured.w, h: el.measured.h }
  }
}

/**
 * 箭头「渲染包围盒」—— 在两端点 AABB 基础上四向外扩固定余量（设计依据：§2.1 图层三纪律之三）。
 *
 * 修的问题：水平/垂直箭头的 elementBounds 返回零面积（零宽或零高）矩形，
 * 视口剔除用半开区间相交（rectsIntersect），零面积矩形与任何视口判定为「不相交」，
 * 最常见的水平流程箭头会被误判不可见而不挂载（v1-scaffold 评审 P2-2）。
 *
 * 外扩余量 = 线宽的一半 + 端头 marker 余量 + 标签余量。逐箭头 SVG 的定位与剔除统一消费此盒
 * （§2.1：不各算各的）。契约固定签名 (el)→Rect，故余量为内置常量（与渲染器默认样式对齐）：
 * - STROKE_HALF：默认线宽 ~2px，半线宽 1px，外加少量抗锯齿/视觉余量
 * - MARKER：末端三角 marker 的伸出量
 * - LABEL：线中点标签的半高/半宽余量（标签为 DOM 元素，居中于线，向四周占位）
 * 三者合并为单一对称外扩量 PAD，保证零面积箭头也有正面积包围盒。
 */
const ARROW_PAD = 16 // 线宽 + marker + 标签的合并外扩余量（px，世界坐标）

export function arrowRenderBounds(el: ArrowElement): Rect {
  return boundsForPoints(el.points)
}

/** 一组点的紧致 AABB（无外扩）；空数组退化为零盒 */
function pointsAABB(points: { x: number; y: number }[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 渲染包围盒：紧致 AABB 四向外扩 ARROW_PAD（含线宽/端头/标签余量）。resolver 与 arrowRenderBounds 同源。 */
export function boundsForPoints(points: { x: number; y: number }[]): Rect {
  const b = pointsAABB(points)
  return { x: b.x - ARROW_PAD, y: b.y - ARROW_PAD, w: b.w + ARROW_PAD * 2, h: b.h + ARROW_PAD * 2 }
}

/**
 * 一组点的紧致 AABB（无 ARROW_PAD 渲染外扩）：框选取盒用——箭头解析后端点的真实线几何盒，
 * 与 elementBounds(arrow) 同语义（真实线几何），但作用于「解析后的 renderPoints」（绑定端已贴目标边）。
 */
export function tightBoundsForPoints(points: { x: number; y: number }[]): Rect {
  return pointsAABB(points)
}

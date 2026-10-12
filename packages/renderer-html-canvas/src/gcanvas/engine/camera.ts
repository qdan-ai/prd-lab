/**
 * 相机与世界↔屏幕坐标变换 —— 无限画布导航的数学地基（设计依据：§1.6、契约 camera.ts）
 *
 * 引擎层纪律：纯 TS、无副作用、可单测；不持有 DOM、不读 window。
 *
 * 坐标形态（本项目固定，勿与旧项目混淆）：
 *   屏幕坐标 = 世界坐标 * zoom + t       —— 即 CSS 的 `translate(tx,ty) scale(zoom)`
 *   故 tx/ty 是「屏幕像素」位移，zoom 是缩放倍数。
 *
 * 公式平移自 pm-canvas-viewer 的已验证实现（出处 §8），但其 transform 顺序为
 *   `scale()·translate()`（屏幕 = scale*(world + pan)，pan 为「世界单位」）。
 * 本项目为 `translate()·scale()`，二者关系：tx = panX*scale、zoom = scale。
 * 因此下方公式是换算后的等价形态，**不是旧项目字面照抄**，并由单测锁定不变量。
 */

import type { Rect } from './viewport'

/** 屏幕 = 世界 * zoom + t。tx/ty 为屏幕像素位移，zoom 为缩放倍数 */
export interface Camera {
  tx: number
  ty: number
  zoom: number
}

/** 平面点（世界坐标或屏幕坐标，视上下文而定） */
export interface Point {
  x: number
  y: number
}

/**
 * 「视口本地坐标」：原点 = 画布区域（viewport）左上角，**非浏览器窗口左上角**。
 * Stage 负责换算：local = client − viewportRect.left/top（旧项目 VIEWPORT_TOP=40 即同一坑，
 * 见 Codex 评审 P1-3）。zoomAt 的锚点必须用此坐标，否则缩放锚点会整体漂移工具栏高度。
 */
export type ViewportPoint = Point

/** 缩放下限/上限（⚖️ 裁定 5，可调）。clamp 在 zoomAt / fitToContent 内强制生效 */
export const ZOOM_MIN = 1 / 32
export const ZOOM_MAX = 8

/** fitToContent 默认余量系数：内容只占视口 92%，四周留白（承袭旧项目 fitAll 0.92） */
const FIT_MARGIN = 0.92

/** bounds 为空或不可 fit 时的默认相机：原点对齐、1:1 */
const DEFAULT_CAMERA: Camera = { tx: 0, ty: 0, zoom: 1 }

const clampZoom = (z: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))

/** 世界坐标 → 屏幕坐标 */
export function worldToScreen(c: Camera, p: Point): Point {
  return { x: p.x * c.zoom + c.tx, y: p.y * c.zoom + c.ty }
}

/** 屏幕坐标 → 世界坐标（worldToScreen 的逆；zoom>0 恒成立，见 clamp） */
export function screenToWorld(c: Camera, p: Point): Point {
  return { x: (p.x - c.tx) / c.zoom, y: (p.y - c.ty) / c.zoom }
}

/** 按屏幕像素位移平移相机（zoom 不变）。裸滚轮/空格拖共用此入口 */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { tx: c.tx + dx, ty: c.ty + dy, zoom: c.zoom }
}

/**
 * 以 anchor（视口本地坐标）为锚点缩放：anchor 处的世界点在缩放前后保持屏幕位置不变。
 *
 * 推导：设缩放前 anchor 对应世界点 w = (anchor − t)/zoom。
 * 要求缩放后仍有 anchor = w*zoom' + t'，解得 t' = anchor − w*zoom'
 *                                            = anchor − (anchor − t)/zoom * zoom'。
 * zoom' 经 clamp 后再回代 —— 保证「碰到缩放上下限时锚点仍不漂移」。
 */
export function zoomAt(c: Camera, anchor: ViewportPoint, factor: number): Camera {
  const newZoom = clampZoom(c.zoom * factor)
  // 注意：用 clamp 后的 newZoom 回代，命中上下限时锚点仍精确不动
  const tx = anchor.x - ((anchor.x - c.tx) / c.zoom) * newZoom
  const ty = anchor.y - ((anchor.y - c.ty) / c.zoom) * newZoom
  return { tx, ty, zoom: newZoom }
}

/**
 * 求 bounds 并集，并以 0.92 余量塞进视口居中（Cmd+0）。
 *
 * 公式（translate·scale 形态）：B = bounds 并集，
 *   zoom = clamp(padding × min(V.w/B.w, V.h/B.h))
 *   tx = (V.w − B.w·zoom)/2 − B.x·zoom    （ty 同理）
 *
 * bounds 为空 → 默认相机（原点 1:1）。
 * 退化并集（B.w 或 B.h 为 0，如全是水平箭头）：该轴跳过、不参与 min，
 * 两轴都退化时回退默认相机（避免除零产生 Infinity）。
 * 调用方负责收集 bounds（html 无 measured 用占位预估、text 粗估，见 §1.6）。
 */
export function fitToContent(
  bounds: Rect[],
  viewport: { w: number; h: number },
  padding: number = FIT_MARGIN,
): Camera {
  if (bounds.length === 0) return { ...DEFAULT_CAMERA }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of bounds) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  const bw = maxX - minX
  const bh = maxY - minY

  // 收集 bounds 全无有限值（理论上不应发生，bounds 非空即至少一个有限矩形）→ 兜底
  if (!Number.isFinite(bw) || !Number.isFinite(bh)) return { ...DEFAULT_CAMERA }

  // 退化轴（宽或高为 0）不参与 min，避免 V/0=Infinity 把 zoom 顶到上限
  const ratios: number[] = []
  if (bw > 0) ratios.push(viewport.w / bw)
  if (bh > 0) ratios.push(viewport.h / bh)
  // 两轴都退化（单点内容）：无几何尺寸可 fit，回退默认相机
  if (ratios.length === 0) return { ...DEFAULT_CAMERA }

  const zoom = clampZoom(padding * Math.min(...ratios))
  const tx = (viewport.w - bw * zoom) / 2 - minX * zoom
  const ty = (viewport.h - bh * zoom) / 2 - minY * zoom
  return { tx, ty, zoom }
}

/**
 * 聚焦单个世界矩形（focusElement 命令的相机底座，设计 Step 4 §11/§12）：把目标矩形带入视口几何中心。
 *
 * 与 fitToContent（Cmd+0 看全局，恒按内容缩放）的区别——focus 是「指哪看哪」的温和聚焦：
 * - **不放大已能容纳的小元素**：zoom = min(当前 zoom, fitZoom)。小元素在当前 zoom 下放得下就保持
 *   当前缩放、只平移居中（避免聚焦时突兀拉近）；元素在当前 zoom 下超出视口才缩小到能容纳。
 * - **恒居中**：目标矩形中心精确映射到视口几何中心（worldToScreen(center) === 视口中心）。
 *
 * 退化矩形（宽或高为 0，如水平/垂直箭头、单点元素）：退化轴跳过、不参与 fit；两轴都退化（单点）→
 * fitZoom 无约束、min 取当前 zoom，仅把该点居中。视口尺寸未就绪（w/h ≤ 0）→ 返回 null，调用方早退
 * （不在 0 尺寸视口上算出错位相机跳错视角，与 viewportCenterWorldRef 未就绪返回 null 同源纪律）。
 *
 * @param rect 目标元素的世界坐标包围盒（调用方用 boundsOf 算）
 * @param viewport 当前视口像素尺寸
 * @param currentZoom 当前相机 zoom（用于 min 取小、不放大小元素）
 * @param padding fit 余量（默认 0.92，与 fitToContent 一致）
 * @returns 聚焦后的相机；视口未就绪返回 null
 */
export function focusRect(
  rect: Rect,
  viewport: { w: number; h: number },
  currentZoom: number,
  padding: number = FIT_MARGIN,
): Camera | null {
  if (viewport.w <= 0 || viewport.h <= 0) return null

  // 退化轴跳过：宽/高为 0 不参与 fit（避免 V/0=Infinity）。两轴都退化（单点）→ ratios 空 → fit 不约束。
  const ratios: number[] = []
  if (rect.w > 0) ratios.push(viewport.w / rect.w)
  if (rect.h > 0) ratios.push(viewport.h / rect.h)
  // fitZoom = 能把矩形带 padding 余量塞进视口的缩放；单点（无尺寸）时设为 +∞ → min 必取当前 zoom
  const fitZoom = ratios.length > 0 ? padding * Math.min(...ratios) : Infinity
  // 温和聚焦：不放大已能容纳的小元素（取当前 zoom）；元素超出视口才缩小（取 fitZoom）。再 clamp 到上下限。
  const zoom = clampZoom(Math.min(currentZoom, fitZoom))

  // 矩形中心 → 视口几何中心：tx/ty 使 worldToScreen(center) === (vp.w/2, vp.h/2)
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const tx = viewport.w / 2 - cx * zoom
  const ty = viewport.h / 2 - cy * zoom
  return { tx, ty, zoom }
}

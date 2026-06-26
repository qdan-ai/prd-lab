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

/** 世界坐标轴对齐矩形（px）。x/y 为左上角，w/h 为宽高（约定非负） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
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

/**
 * 可绑元素几何地基（设计 §横切地基 §48 elementGeometry）——箭头绑定「锚点 / 连接点落在哪」的几何真相源。
 *
 * 对每类可绑元素给出：① bbox（= elementBounds，与选择框 / 框选同一套盒，不另造）
 * ② 轮廓（当前均为凸多边形）③ 线段∩轮廓求交 ④ 轮廓最近点 ⑤ 按 gap 外扩轮廓（连接点留白）。
 * 可绑集合 = html / image / frame / shape(rect|diamond)：rect 类取 bbox 四角、diamond 取 bbox 四边中点。
 * 消费者（阶段2 resolveArrowGeometry 的 binding 端点求交）统一调用，禁止各处自算元素轮廓。
 *
 * 线段求交 / 点到线段投影 / 凸多边形斜接偏移的参数式解法摘自 excalidraw（MIT，@excalidraw/math）改写；
 * 元素→轮廓、锚点映射等接线自写。
 */
import type { CanvasElement } from './schema'
import { type Rect, elementBounds } from './viewport'

/** 数值容差：判平行 / 去重 / 退化点用同一阈值 */
const EPS = 1e-9

/**
 * 斜接（miter）顶点位移的上限倍率（相对 gap）：位移 = gap·√(2/denom)，超此值的尖角改斜切（bevel）。
 * denom=1（rect / 90° 顶点）位移 √2·gap<2·gap 保持尖角；扁多边形侧顶点位移发散则被截为 bevel。
 */
const MITER_LIMIT = 2

/** 平面点（世界坐标 px）；结构与 ArrowPoint 兼容，消费者可直接互传 */
export interface Vec {
  x: number
  y: number
}

/**
 * 元素轮廓。当前仅凸多边形（rect / diamond 均落此形态）：
 * 顶点按序、首尾隐式闭合（最后一点连回第一点）。
 * kind 判别位为将来真实曲线元素预留——届时新增 'curve' 分支，消费者按 kind 分派，本模块算子随之扩。
 */
export type ElementContour = { kind: 'polygon'; vertices: Vec[] }

export interface ElementGeometry {
  /** 轴对齐包围盒（= elementBounds，与选择框 / 框选同源） */
  bbox: Rect
  /** 求交 / 最近点 / 外扩的作用对象 */
  contour: ElementContour
}

/**
 * 解析可绑元素几何。返回 null = 此元素当前不可作绑定目标：
 * - text / arrow：不在可绑集合内；
 * - 未 measured 的 html：尺寸尚不可几何确定（与 elementBounds 同步返回 null）。
 *   此时消费者应把该端 binding 降级为原端点坐标（悬空），不臆造占位盒——占位是写侧落位的避让估算，
 *   绑定求交是读侧对目标真实几何的消费，读侧不冒充事实（同 ls-analyze 读侧诚实原则）。
 */
export function elementGeometry(el: CanvasElement): ElementGeometry | null {
  switch (el.type) {
    case 'text':
    case 'arrow':
      return null
    case 'html':
    case 'image':
    case 'frame':
    case 'shape': {
      const bbox = elementBounds(el)
      if (!bbox) return null
      const diamond = el.type === 'shape' && el.shape === 'diamond'
      const vertices = diamond ? diamondVertices(bbox) : rectVertices(bbox)
      return { bbox, contour: { kind: 'polygon', vertices } }
    }
  }
}

/**
 * 归一化锚点 fixedPoint=[u,v]∈[0,1]² → 世界坐标（u=0 左 / 1 右，v=0 上 / 1 下）。
 * 绑定「读侧」（fixedPoint→世界）的单一入口：消费者据此把 binding.fixedPoint 还原为锚点世界坐标，
 * 再从对端射向此锚点求连接点。写侧（世界→fixedPoint）取逆映射 worldToFixedPoint，须与本函数自洽。
 */
export function anchorPoint(bbox: Rect, fixedPoint: readonly [number, number]): Vec {
  return { x: bbox.x + fixedPoint[0] * bbox.w, y: bbox.y + fixedPoint[1] * bbox.h }
}

/**
 * 世界坐标 → 归一化锚点 fixedPoint=[u,v]，钳到 [0,1]²（bbox 外的落点贴到最近边/角）。
 * 绑定「写侧」的单一入口，取 anchorPoint 的逆：bbox 内的落点 world 满足 anchorPoint(bbox, 本函数(world))===world；
 * bbox 外的落点钳后与 anchorPoint 仍自洽（钳定即幂等）。零宽/零高退化维记 0（不除零）。
 */
export function worldToFixedPoint(bbox: Rect, world: Vec): [number, number] {
  const u = bbox.w !== 0 ? (world.x - bbox.x) / bbox.w : 0
  const v = bbox.h !== 0 ? (world.y - bbox.y) / bbox.h : 0
  return [clamp01(u), clamp01(v)]
}

/** 凸轮廓「点在内」判定（含边上）：落点在每条边的内侧（外法线方向投影 ≤0）即在内。用于绑定感应带内芯判定。 */
export function isPointInContour(contour: ElementContour, p: Vec): boolean {
  const vs = contour.vertices
  if (vs.length < 3) return false
  const centroid = centroidOf(vs)
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i]!
    const n = outwardNormal(a, vs[(i + 1) % vs.length]!, centroid)
    if ((p.x - a.x) * n.x + (p.y - a.y) * n.y > EPS) return false
  }
  return true
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * 线段 a→b 与轮廓的全部交点，按沿 a→b 的参数 t 升序（t=0 在 a、t=1 在 b、闭区间含端点）。无交点返回空数组。
 * 消费场景：a=箭头对端点、b=锚点世界坐标；对端在外、锚点在内时凸轮廓恰有一个交点，取 [0] 即入边连接点。
 */
export function segmentContourIntersections(contour: ElementContour, a: Vec, b: Vec): Vec[] {
  const vs = contour.vertices
  const hits: { t: number; p: Vec }[] = []
  for (let i = 0; i < vs.length; i++) {
    const c = vs[i]!
    const d = vs[(i + 1) % vs.length]!
    const hit = segmentIntersect(a, b, c, d)
    if (hit) hits.push(hit)
  }
  hits.sort((h1, h2) => h1.t - h2.t)
  // 线段恰穿过某顶点时，共享该顶点的两条边会各报一次同一交点，按 t 近邻去重
  const out: Vec[] = []
  let prevT = -Infinity
  for (const h of hits) {
    if (h.t - prevT > EPS) out.push(h.p)
    prevT = h.t
  }
  return out
}

/** 轮廓上距 p 最近的点（遍历各边取投影钳制点，取全局最近）。 */
export function closestPointOnContour(contour: ElementContour, p: Vec): Vec {
  const vs = contour.vertices
  let best: Vec = vs[0]!
  let bestD = Infinity
  for (let i = 0; i < vs.length; i++) {
    const q = closestPointOnSegment(p, vs[i]!, vs[(i + 1) % vs.length]!)
    const dd = dist2(p, q)
    if (dd < bestD) {
      bestD = dd
      best = q
    }
  }
  return best
}

/**
 * 凸轮廓沿外法线整体外扩 gap（连接点留白：`gap = 基础留白 + strokeWidth/2`）。gap≤0 原样返回。
 * 每条边沿其外法线平移 gap（各边留白等宽）；顶点按接法分两种：
 * - 钝角 / 直角：斜接（miter）—— v' = v + gap·(n1+n2)/(1+n1·n2)，n1/n2 为夹此顶点两边的单位外法线；
 *   rect（相邻边正交，denom=1）与 90° 菱形顶点均保持尖角，位移 √2·gap。
 * - 尖角：斜切（bevel）—— 顶点裂为入边 / 出边各自的 gap 偏移点，位移恒 = gap。
 *
 * denom=1+n1·n2 虽在凸多边形恒 >0，却随夹角变尖趋 0，斜接位移倍率 √(2/denom) 随之发散：
 * 扁菱形（长宽比悬殊）的侧顶点即属此列，任其斜接会把顶点甩出老远、外扩轮廓鼓成大包，
 * 反把本在元素外的查询端点吞进「内部」→ 求交落空 → 绑定端点静默降级为陈旧坐标。
 * 故位移超 MITER_LIMIT·gap 的尖角改斜切：位移收敛回 gap，凸多边形外扩恒为简单多边形（不自相交）。
 */
export function contourInflate(contour: ElementContour, gap: number): ElementContour {
  if (gap <= 0) return contour
  const vs = contour.vertices
  const n = vs.length
  const centroid = centroidOf(vs)
  // 每条边 i（vs[i]→vs[i+1]）的单位外法线
  const edgeNormals = vs.map((v, i) => outwardNormal(v, vs[(i + 1) % n]!, centroid))
  const vertices: Vec[] = []
  for (let i = 0; i < n; i++) {
    const v = vs[i]!
    const nNext = edgeNormals[i]! // 边 i→i+1（此顶点为起点）
    const nPrev = edgeNormals[(i - 1 + n) % n]! // 边 i-1→i（此顶点为终点）
    const denom = 1 + (nPrev.x * nNext.x + nPrev.y * nNext.y)
    // 斜接位移倍率 √(2/denom) 在 MITER_LIMIT 内 → 尖角斜接；超限（含近共线尖顶 denom→0）→ 斜切裂两点
    if (denom > EPS && 2 / denom <= MITER_LIMIT * MITER_LIMIT) {
      const k = gap / denom
      vertices.push({ x: v.x + k * (nPrev.x + nNext.x), y: v.y + k * (nPrev.y + nNext.y) })
    } else {
      vertices.push({ x: v.x + gap * nPrev.x, y: v.y + gap * nPrev.y }) // 入边偏移点
      vertices.push({ x: v.x + gap * nNext.x, y: v.y + gap * nNext.y }) // 出边偏移点
    }
  }
  return { kind: 'polygon', vertices }
}

// ---------------------------------------------------------------------------
// 元素 → 轮廓顶点（世界坐标；顺时针，屏幕系 y 向下）
// ---------------------------------------------------------------------------

/** bbox 四角（矩形轮廓：html / image / frame / shape-rect 共用） */
function rectVertices(r: Rect): Vec[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]
}

/** bbox 四边中点（菱形轮廓；与 ShapeView clip-path `polygon(50% 0,100% 50%,50% 100%,0 50%)` 同顶点） */
function diamondVertices(r: Rect): Vec[] {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return [
    { x: cx, y: r.y }, // 上中
    { x: r.x + r.w, y: cy }, // 右中
    { x: cx, y: r.y + r.h }, // 下中
    { x: r.x, y: cy }, // 左中
  ]
}

// ---------------------------------------------------------------------------
// 几何原语（改写自 excalidraw @excalidraw/math，MIT）
// ---------------------------------------------------------------------------

/** 二维叉积 u×v */
function cross(u: Vec, v: Vec): number {
  return u.x * v.y - u.y * v.x
}

function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * 两线段求交（a→b 与 c→d），命中返回沿 a→b 的参数 t 与交点；平行 / 共线 / 段外一律 null。
 * 参数式：交点 = a + t·(b−a) = c + u·(d−c)，t,u∈[0,1] 方为段内有效交点（闭区间含端点）。
 * 零长线段（a=b 或 c=d）令方向向量为零 → denom=0 → null。
 */
function segmentIntersect(a: Vec, b: Vec, c: Vec, d: Vec): { t: number; p: Vec } | null {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denom = cross(r, s)
  if (Math.abs(denom) < EPS) return null // 平行 / 共线 / 含零长线段
  const ac = { x: c.x - a.x, y: c.y - a.y }
  const t = cross(ac, s) / denom
  const u = cross(ac, r) / denom
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return { t, p: { x: a.x + t * r.x, y: a.y + t * r.y } }
}

/** 点 p 到线段 a→b 的最近点（投影钳制到 [0,1]；零长线段退回 a） */
function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 < EPS) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { x: a.x + t * abx, y: a.y + t * aby }
}

/** 多边形顶点形心（凸多边形取顶点均值即可判「外」向） */
function centroidOf(vs: Vec[]): Vec {
  let sx = 0
  let sy = 0
  for (const v of vs) {
    sx += v.x
    sy += v.y
  }
  return { x: sx / vs.length, y: sy / vs.length }
}

/** 边 a→b 的单位外法线（两候选法线中取远离 centroid 的一侧），winding 无关 */
function outwardNormal(a: Vec, b: Vec, centroid: Vec): Vec {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  let nx = dy / len
  let ny = -dx / len
  const midx = (a.x + b.x) / 2
  const midy = (a.y + b.y) / 2
  if ((midx - centroid.x) * nx + (midy - centroid.y) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  return { x: nx, y: ny }
}

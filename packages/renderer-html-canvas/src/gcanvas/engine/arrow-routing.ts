/**
 * auto 两端绑箭头的直角路由地基（设计 阶段3 §D §256-261 / 阶段2 §167）——「直角折线走哪条边、拐哪几下」
 * 的纯几何真相源。仅算路径，不碰交互 / 不入库；由 resolveArrowGeometry 的 auto 两端绑分支调用。
 *
 * 三步：① 选边（floating 磁吸按两端相对位置 |dx| vs |dy| 选朝对端的边；fixed 精确尊重 fixedPoint 所在边）
 * ② 沿边投影出连接点（垂直进边、gap 留白，磁吸→边中点 / 精确→对齐锚点的偏移位）③ 按两端 side 生成
 * L / Z / C 正交折线（派生拐点）。**不避障**——只按两端几何选路，不绕开中间挡路元素。
 *
 * 选边 / 象限判向思路参考 excalidraw `heading.ts`（MIT）改写；路径拼接与去冗自写。
 */
import type { ArrowBinding } from './schema'
import type { Rect } from './viewport'
import { anchorPoint, type Vec } from './element-geometry'

/** 数值容差：判共线 / 去重 / 零长用同一阈值 */
const EPS = 1e-9

/**
 * 垂直进出边的最小引出段（世界 px）：连接点与对端相对位置「反向」时（简单 L 会扎回元素），先沿边法线
 * 引出这一段再绕连，令折线不穿过源元素。取值仅需 >0，具体长度不影响连通性、只影响拐角离元素多远。
 */
const ROUTE_STUB = 20

export type Side = 'left' | 'right' | 'top' | 'bottom'

/** 每条边的单位外法线（屏幕系 y 向下：top 法线朝上 = -y） */
const SIDE_NORMAL: Record<Side, Vec> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
}

/** 左右边为水平朝向（连接点沿 x 轴进出），上下边为垂直朝向 */
function isHorizontalSide(side: Side): boolean {
  return side === 'left' || side === 'right'
}

/**
 * 选边（这条边从哪进出）：
 * - **floating（磁吸）**：按元素中心朝对端中心的主轴选边（|dx| ≥ |dy| → 左/右，否则 上/下）——朝对端最近的边。
 *   两端都磁吸时两侧恒落同一主轴、相对而向，故成 Z / 直线。
 * - **fixed（精确）**：尊重 fixedPoint 所在边（离哪条边最近就选哪条），不因对端方向另选（§79 / §167）。
 *   一端精确迫其边垂直于对端边时，两侧成 L。
 */
export function chooseSide(bbox: Rect, binding: ArrowBinding, otherBbox: Rect): Side {
  if (binding.mode === 'fixed') return sideOfFixedPoint(binding.fixedPoint)
  const otherCenter = { x: otherBbox.x + otherBbox.w / 2, y: otherBbox.y + otherBbox.h / 2 }
  return sideTowardPoint(bbox, otherCenter)
}

/** 元素中心朝 target 的主轴边（|dx| ≥ |dy| → 右/左；否则 下/上）。对角线（|dx|=|dy|）平手归水平。 */
function sideTowardPoint(bbox: Rect, target: Vec): Side {
  const dx = target.x - (bbox.x + bbox.w / 2)
  const dy = target.y - (bbox.y + bbox.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/** fixedPoint=[u,v] 离哪条边最近就属哪条边（角点平手时按 左>右>上>下 定序）。 */
function sideOfFixedPoint(fixedPoint: readonly [number, number]): Side {
  const [u, v] = fixedPoint
  const dLeft = u
  const dRight = 1 - u
  const dTop = v
  const dBottom = 1 - v
  const min = Math.min(dLeft, dRight, dTop, dBottom)
  if (min === dLeft) return 'left'
  if (min === dRight) return 'right'
  if (min === dTop) return 'top'
  return 'bottom'
}

/**
 * 直角连接点 =「选边 + fixedPoint 沿边投影」（§167）：把锚点投到选中边、再沿外法线外移 gap。
 * - 磁吸锚点（中心 [0.5,0.5]）→ 落该边中点；精确锚点 → 落该边上对齐锚点的偏移位。
 * - 垂直边（左/右）固定 x=边±gap、y 取锚点 y（钳进 bbox 高度）；水平边（上/下）反之。
 * 此连接点即直角折线的末端点，端点手柄落于此（与自由/直线连接点分流，同一 resolver 内共用锚点映射）。
 */
export function orthoConnectionPoint(
  bbox: Rect,
  fixedPoint: readonly [number, number],
  side: Side,
  gap: number,
): Vec {
  const anchor = anchorPoint(bbox, fixedPoint)
  switch (side) {
    case 'right':
      return { x: bbox.x + bbox.w + gap, y: clamp(anchor.y, bbox.y, bbox.y + bbox.h) }
    case 'left':
      return { x: bbox.x - gap, y: clamp(anchor.y, bbox.y, bbox.y + bbox.h) }
    case 'bottom':
      return { x: clamp(anchor.x, bbox.x, bbox.x + bbox.w), y: bbox.y + bbox.h + gap }
    case 'top':
      return { x: clamp(anchor.x, bbox.x, bbox.x + bbox.w), y: bbox.y - gap }
  }
}

/**
 * 由两端连接点 + 各自 side 生成正交折线 [p0, ...派生拐点, p1]：
 * - **同轴相对**（一左一右 / 一上一下）→ Z（中段等分居中）；两端同坐标 → 去冗为直线。
 * - **同轴同向**（都朝左 / 都朝右…，仅精确端可致）→ C（引出到两端外侧再折回）。
 * - **垂直**（一水平一垂直）→ L；简单 L 角点会反向扎回元素时 → 带 stub 引出再绕连（至多 5 点）。
 * 末端始终为 p0 / p1（连接点即路径末端）；所有拐角轴对齐、相邻段交替横竖。
 */
export function routeOrthogonal(p0: Vec, side0: Side, p1: Vec, side1: Side): Vec[] {
  const h0 = isHorizontalSide(side0)
  const h1 = isHorizontalSide(side1)
  if (h0 && h1) return routeSameAxisH(p0, side0, p1, side1)
  if (!h0 && !h1) return routeSameAxisV(p0, side0, p1, side1)
  return routePerpendicular(p0, side0, p1, side1)
}

/**
 * 从元素连接点 `cp`（在 `side` 边、垂直进出）到一个**自由点** `target` 的正交尾巴（阶段3 §C 智能尾巴）：
 * `cp` 先沿 `side` 外法线引出，再折到 `target`；末端恒 = `target`。返回 [cp, ...派生拐点, target]。
 * - 简单 L（`target` 在引出方向侧）→ [cp, 拐点, target]，共线则去冗为直线 [cp, target]。
 * - 反向（`target` 在 cp 背侧，简单 L 会扎回源元素）→ 引出 stub 再绕连 [cp, a, 拐点, target]。
 *
 * 与 `routeOrthogonal` 的分野：另一端是自由点（拐点 / 手摆端），无边约束、不强制垂直进入——故 `target`
 * 侧不投影连接点、不引 stub，只 `cp` 侧垂直引出。用于 manual 箭头绑定端的末梢一段（连接点 → 相邻拐点）。
 */
export function routeOrthogonalToFreePoint(cp: Vec, side: Side, target: Vec): Vec[] {
  const n = SIDE_NORMAL[side]
  const h = isHorizontalSide(side)
  // 简单 L 角点：水平边 → 拐点与 cp 同 y、与 target 同 x（先水平引出）；垂直边 → 反之
  const corner: Vec = h ? { x: target.x, y: cp.y } : { x: cp.x, y: target.y }
  // 起段 cp→corner 顺法线（垂直引出）→ 干净 L；反向则引出 stub 再绕连
  if (movesAlong(cp, corner, n)) return simplify([cp, corner, target])
  const a: Vec = { x: cp.x + n.x * ROUTE_STUB, y: cp.y + n.y * ROUTE_STUB }
  const bend: Vec = h ? { x: a.x, y: target.y } : { x: target.x, y: a.y }
  return simplify([cp, a, bend, target])
}

/** 两端皆水平边：相对 → Z（竖直中段）；同向 → C（引出到外侧竖直折回）。 */
function routeSameAxisH(p0: Vec, side0: Side, p1: Vec, side1: Side): Vec[] {
  if (side0 !== side1) {
    const midX = (p0.x + p1.x) / 2
    return simplify([p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1])
  }
  const outX =
    side0 === 'right' ? Math.max(p0.x, p1.x) + ROUTE_STUB : Math.min(p0.x, p1.x) - ROUTE_STUB
  return simplify([p0, { x: outX, y: p0.y }, { x: outX, y: p1.y }, p1])
}

/** 两端皆垂直边：相对 → Z（水平中段）；同向 → C（引出到外侧水平折回）。 */
function routeSameAxisV(p0: Vec, side0: Side, p1: Vec, side1: Side): Vec[] {
  if (side0 !== side1) {
    const midY = (p0.y + p1.y) / 2
    return simplify([p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1])
  }
  const outY =
    side0 === 'bottom' ? Math.max(p0.y, p1.y) + ROUTE_STUB : Math.min(p0.y, p1.y) - ROUTE_STUB
  return simplify([p0, { x: p0.x, y: outY }, { x: p1.x, y: outY }, p1])
}

/**
 * 一水平边一垂直边：优先简单 L（单拐点）；若某段会反向扎回其元素（对端落在「不该来」的一侧），
 * 改为两端各沿法线引出 stub 后绕连的 5 点折线，保证每段都顺各自 heading 引出、不穿源元素。
 */
function routePerpendicular(p0: Vec, side0: Side, p1: Vec, side1: Side): Vec[] {
  const n0 = SIDE_NORMAL[side0]
  const n1 = SIDE_NORMAL[side1]
  const h0 = isHorizontalSide(side0)
  // 简单 L 角点：起端水平 → 拐点与起端同 y、与末端同 x；起端垂直 → 反之
  const corner: Vec = h0 ? { x: p1.x, y: p0.y } : { x: p0.x, y: p1.y }
  // 两段都顺各自 heading（起段沿 n0 外引、末段沿 -n1 入 B）→ 干净 L
  if (movesAlong(p0, corner, n0) && movesAlong(corner, p1, negate(n1))) {
    return simplify([p0, corner, p1])
  }
  // 反向 → 引出 stub 再绕连
  const a: Vec = { x: p0.x + n0.x * ROUTE_STUB, y: p0.y + n0.y * ROUTE_STUB }
  const b: Vec = { x: p1.x + n1.x * ROUTE_STUB, y: p1.y + n1.y * ROUTE_STUB }
  const mid: Vec = h0 ? { x: a.x, y: b.y } : { x: b.x, y: a.y }
  return simplify([p0, a, mid, b, p1])
}

/** 段 from→to 沿 dir 非反向（同向或零长；本模块段恒轴对齐，故只需点乘 ≥0）。 */
function movesAlong(from: Vec, to: Vec, dir: Vec): boolean {
  return (to.x - from.x) * dir.x + (to.y - from.y) * dir.y >= -EPS
}

function negate(v: Vec): Vec {
  return { x: -v.x, y: -v.y }
}

/**
 * 去重相邻重合点 + 去共线冗余中间点（前后两段同轴 → 中点多余）。本模块折线各段轴对齐且不产生反向尖刺，
 * 故「三点共 x 或共 y」即真正的直线延续（非折回），去之等价化简，不会误删拐角。
 */
function simplify(pts: Vec[]): Vec[] {
  const dedup: Vec[] = []
  for (const p of pts) {
    const last = dedup[dedup.length - 1]
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) dedup.push(p)
  }
  if (dedup.length <= 2) return dedup
  const out: Vec[] = [dedup[0]!]
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1]!
    const b = dedup[i]!
    const c = dedup[i + 1]!
    const colX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS
    const colY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS
    if (colX || colY) continue // b 冗余
    out.push(b)
  }
  out.push(dedup[dedup.length - 1]!)
  return out
}

function clamp(t: number, lo: number, hi: number): number {
  return t < lo ? lo : t > hi ? hi : t
}

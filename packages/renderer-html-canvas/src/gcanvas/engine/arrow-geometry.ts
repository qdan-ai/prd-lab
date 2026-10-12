/**
 * 箭头几何解析地基（设计 §横切地基 resolveArrowGeometry）——「点从哪来」的单一真相源。
 * 能力：manual→points；auto→两端直线（首尾）；端点绑元素时按 binding 求交贴到目标轮廓边（orbit）；
 * auto 两端绑不同元素→直角折线（选边 + 沿边投影 + L/Z/C 派生拐点，见 arrow-routing）。
 * 所有消费者（渲染 / 包围盒 / 手柄 / 预览）统一调用，禁止各模块各读 points，否则 auto 直角箭头选不中、
 * 复制丢形、手柄错位。
 */
import type { ArrowBinding, ArrowElement, ArrowPoint, CanvasDoc } from './schema'
import { type Rect, boundsForPoints, tightBoundsForPoints } from './viewport'
import {
  anchorPoint,
  closestPointOnContour,
  contourInflate,
  elementGeometry,
  segmentContourIntersections,
  type ElementGeometry,
  type Vec,
} from './element-geometry'
import {
  chooseSide,
  orthoConnectionPoint,
  routeOrthogonal,
  routeOrthogonalToFreePoint,
} from './arrow-routing'

/** 样式默认值单一来源（UI / 渲染 / 复制共用；默认下视觉与旧版一致） */
export interface ArrowStyle {
  strokeColor: string
  strokeWidth: number
  strokeStyle: 'solid' | 'dashed' | 'dotted'
  startArrowhead: 'none' | 'triangle' | 'arrow'
  endArrowhead: 'none' | 'triangle' | 'arrow'
  curved: boolean
  routing: 'auto' | 'manual'
}

export const arrowDefaults: ArrowStyle = {
  strokeColor: '#4a4439',
  strokeWidth: 2,
  strokeStyle: 'solid',
  startArrowhead: 'none',
  endArrowhead: 'triangle',
  curved: false,
  routing: 'auto',
}

/** 合并默认值：给 ArrowView / 复制读同一套 */
export function normalizeArrowForRender(el: ArrowElement): ArrowStyle {
  return {
    strokeColor: el.strokeColor ?? arrowDefaults.strokeColor,
    strokeWidth: el.strokeWidth ?? arrowDefaults.strokeWidth,
    strokeStyle: el.strokeStyle ?? arrowDefaults.strokeStyle,
    startArrowhead: el.startArrowhead ?? arrowDefaults.startArrowhead,
    endArrowhead: el.endArrowhead ?? arrowDefaults.endArrowhead,
    curved: el.curved ?? arrowDefaults.curved,
    routing: el.routing ?? arrowDefaults.routing,
  }
}

export type ArrowHandleKind = 'endpoint' | 'waypoint' | 'derived'

export interface ArrowHandle {
  x: number
  y: number
  /** 在 persistedPoints 中的下标；derived（阶段3 派生点）为 -1 */
  index: number
  kind: ArrowHandleKind
}

export interface ResolvedArrowGeometry {
  /** 实际画出来的点（阶段3 auto 直角会含派生拐点） */
  renderPoints: ArrowPoint[]
  /** 应入库的点（= el.points） */
  persistedPoints: ArrowPoint[]
  startPoint: ArrowPoint
  endPoint: ArrowPoint
  /** 可编辑手柄（端点 + 拐点）；阶段1 只有两端点 */
  handlePoints: ArrowHandle[]
  /** 渲染包围盒（含外扩），与 arrowRenderBounds 同源 */
  bounds: Rect
  /** 已解析绑定（回显 arrow.start/endBinding；doc 在场时对应端点已按之求交贴边） */
  startBinding: ArrowBinding | null
  endBinding: ArrowBinding | null
}

/**
 * 连接点与目标轮廓之间的基础留白（px，世界坐标）。实际留白 `gap = 基础留白 + strokeWidth/2`：
 * 使连接点落在目标外一圈留白环上、不贴死边缘；随线宽加粗同步外扩，粗线端头也不戳进目标。
 * gap 不入库、每次解析按当前线宽现算（绑定只存 fixedPoint / mode，连接点是派生量）。
 */
const BINDING_BASE_GAP = 4

/**
 * 解析箭头几何——「点从哪来」的单一真相源。
 *
 * 基础点（未绑定）：manual→全部 points；auto→两端直线（首尾，阶段3 才生成直角拐点）。
 *
 * binding 端点求交（orbit 贴边）：`doc` 在场且某端绑了可解析目标时，该端点落到目标轮廓外扩
 * `gap` 留白环上——从「对端参考点」射向锚点、取入边交点。目标不可解析（未 measured / 已删 /
 * 非可绑类型）或求交空 → 该端悬空降级为原端点坐标（`arrow.points` 原首/尾），绝不因绑定解析失败而崩。
 * `doc` 为 null（创建预览 / 无绑定挂载 / 遗留调用）→ 跳过求交，行为与未绑定完全一致（向后兼容）。
 *
 * 自由 / 直线连接点（任意角度贴边，orbit）用于 manual 与单端绑 auto。auto 两端绑不同元素时改走直角路由
 * （选边 + 沿边投影，见 arrow-routing）：连接点垂直进边、路径为派生 L/Z/C 折线；派生拐点每帧重算、不入库
 * （persistedPoints 恒 = 存库两端点），出可拖手柄（kind='derived'）——拖派生拐点即就地转 manual、固化当前
 * 直角形状（见 orthogonalGeometry / dragDerivedToManual）。manual 绑定端 ≥3 点则末梢一段走智能尾巴（见上）。
 */
export function resolveArrowGeometry(
  doc: CanvasDoc | null,
  arrow: ArrowElement,
): ResolvedArrowGeometry {
  const pts = arrow.points
  const routing = arrow.routing ?? arrowDefaults.routing
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  // 未绑定时的基础渲染点：auto 只留两端、manual 保全部拐点
  const base = routing === 'manual' ? pts : [first, last]

  const startBinding = arrow.startBinding ?? null
  const endBinding = arrow.endBinding ?? null

  // 每端目标几何 + 锚点各解析一次（doc 缺席则整体跳过绑定求交）
  const startGeo = doc ? bindingTargetGeometry(doc, startBinding) : null
  const endGeo = doc ? bindingTargetGeometry(doc, endBinding) : null

  // auto 两端绑不同元素 → 直角路由（选边 + 沿边投影 + 派生折线）。两端绑同一元素（锚点重合、无从选边）
  // 退回直线 orbit（下方）走既有零长降级，不进直角分支。
  if (
    routing !== 'manual' &&
    startGeo &&
    endGeo &&
    startBinding &&
    endBinding &&
    startBinding.elementId !== endBinding.elementId
  ) {
    return orthogonalGeometry(pts, startGeo, startBinding, endGeo, endBinding, arrow)
  }

  const startAnchor =
    startGeo && startBinding ? anchorPoint(startGeo.bbox, startBinding.fixedPoint) : null
  const endAnchor = endGeo && endBinding ? anchorPoint(endGeo.bbox, endBinding.fixedPoint) : null

  // 求交用的「对端参考点」：多拐点时取相邻拐点（尊重折弯方向）；单段（2 点 / auto）时取对端锚点
  // （对端也绑，则连接线为「锚点↔锚点」更稳）或对端原坐标。
  const startFrom: Vec = base.length > 2 ? base[1]! : (endAnchor ?? base[base.length - 1]!)
  const endFrom: Vec = base.length > 2 ? base[base.length - 2]! : (startAnchor ?? base[0]!)

  const gap = BINDING_BASE_GAP + (arrow.strokeWidth ?? arrowDefaults.strokeWidth) / 2
  // 求交失败（geo/锚点缺席或空交点）→ 降级为原首/尾点（悬空）。mode 分流磁吸（orbit）/ 精确（咬边）。
  const startPoint =
    connectionPoint(startGeo, startAnchor, startFrom, gap, startBinding?.mode ?? 'floating') ?? first
  const endPoint =
    connectionPoint(endGeo, endAnchor, endFrom, gap, endBinding?.mode ?? 'floating') ?? last

  // 智能尾巴（阶段3 §C §246-254）：manual 且 ≥3 点时，**被绑的那一端**末梢一段（连接点 ↔ 相邻拐点）走直角
  // 智能路由——垂直进边、派生尾巴拐点不入库；中间拐点全钉死。拖端点即重绑该端 → 尾巴自然重路由（每帧现算），
  // 其余段保持手摆。未绑端 / 2 点（纯手动直线，§250）/ auto 单端绑仍走上面的 orbit·直线连接点。
  const smartTail = routing === 'manual' && base.length > 2
  const startSeg: ArrowPoint[] =
    smartTail && startGeo && startBinding
      ? orthoTail(startGeo, startBinding, gap, base[1]!)
      : [startPoint]
  const endSeg: ArrowPoint[] =
    smartTail && endGeo && endBinding
      ? orthoTail(endGeo, endBinding, gap, base[base.length - 2]!).reverse()
      : [endPoint]
  const renderPoints: ArrowPoint[] =
    base.length > 2 ? [...startSeg, ...base.slice(1, -1), ...endSeg] : [startPoint, endPoint]

  // 视觉端点 = renderPoints 两端（智能尾巴时 = 直角连接点，否则 = orbit 连接点）。手柄端点落此处。
  const effStart = renderPoints[0]!
  const effEnd = renderPoints[renderPoints.length - 1]!

  // 手柄与 base 同构：auto 只出两端端点手柄（不为被收窄掉的中间点造幽灵 waypoint），manual 才出中间拐点
  // 手柄。端点手柄落在解析后的视觉端点（可抓点）、拐点保持持久坐标；index 恒指该点在持久 points 中的下标
  // （首=0、尾=pts.length-1、manual 中间点即其位）。智能尾巴的派生拐点在 renderPoints 层、不进手柄集
  // （auto 直角派生点的可拖手柄见 orthogonalGeometry）。
  const lastBaseIdx = base.length - 1
  const lastPtsIdx = pts.length - 1
  const handlePoints: ArrowHandle[] = base.map((p, i) => {
    const isStart = i === 0
    const isEnd = i === lastBaseIdx
    const at = isStart ? effStart : isEnd ? effEnd : p
    return {
      x: at.x,
      y: at.y,
      index: isStart ? 0 : isEnd ? lastPtsIdx : i,
      kind: isStart || isEnd ? 'endpoint' : 'waypoint',
    }
  })

  return {
    renderPoints,
    persistedPoints: pts,
    startPoint: effStart,
    endPoint: effEnd,
    handlePoints,
    bounds: boundsForPoints(renderPoints),
    startBinding,
    endBinding,
  }
}

/**
 * auto 两端绑不同元素的直角几何：两端各「选边 + 沿边投影」出连接点，再由 arrow-routing 生成 L/Z/C 折线。
 * 派生拐点写进 renderPoints（每帧重算、不入库 —— persistedPoints 恒 = 存库两端点）；bounds 取全体 render
 * 点 AABB 外扩，天然纳入凸出两端的拐段（§102）。
 *
 * 手柄：两端点（kind='endpoint'、index 指持久首/尾 = 拖端点重绑路径）+ 中间派生拐点（kind='derived'、
 * index = 该点在 renderPoints 中的下标 = 冻结成 manual 后其在 points 中的下标）。拖派生拐点即就地转 manual、
 * 固化当前直角形状并移动该点（dragDerivedToManual，阶段3 §B）；加拐点手柄由消费者按 renderPoints 段中点派生。
 */
function orthogonalGeometry(
  pts: ArrowPoint[],
  startGeo: ElementGeometry,
  startBinding: ArrowBinding,
  endGeo: ElementGeometry,
  endBinding: ArrowBinding,
  arrow: ArrowElement,
): ResolvedArrowGeometry {
  const gap = BINDING_BASE_GAP + (arrow.strokeWidth ?? arrowDefaults.strokeWidth) / 2
  const startSide = chooseSide(startGeo.bbox, startBinding, endGeo.bbox)
  const endSide = chooseSide(endGeo.bbox, endBinding, startGeo.bbox)
  const cpStart = orthoConnectionPoint(startGeo.bbox, startBinding.fixedPoint, startSide, gap)
  const cpEnd = orthoConnectionPoint(endGeo.bbox, endBinding.fixedPoint, endSide, gap)
  const route = routeOrthogonal(cpStart, startSide, cpEnd, endSide)
  const renderPoints: ArrowPoint[] = route.map((p) => ({ x: p.x, y: p.y }))
  const startPoint = renderPoints[0]!
  const endPoint = renderPoints[renderPoints.length - 1]!
  // 两端点（重绑路径）+ 中间派生拐点（可拖转 manual）。派生拐点 index = 其 renderPoints 下标（冻结后即
  // points 下标），拖它 → dragDerivedToManual 固化+移动。SelectionOverlay 按位置（首尾=端点、中间=可拖点）分派。
  const handlePoints: ArrowHandle[] = [
    { x: startPoint.x, y: startPoint.y, index: 0, kind: 'endpoint' },
    ...renderPoints
      .slice(1, -1)
      .map((p, k): ArrowHandle => ({ x: p.x, y: p.y, index: k + 1, kind: 'derived' })),
    { x: endPoint.x, y: endPoint.y, index: pts.length - 1, kind: 'endpoint' },
  ]
  return {
    renderPoints,
    persistedPoints: pts,
    startPoint,
    endPoint,
    handlePoints,
    bounds: boundsForPoints(renderPoints),
    startBinding,
    endBinding,
  }
}

/**
 * manual 智能尾巴的末梢一段（阶段3 §C §246-254）：绑定端「连接点 → 相邻拐点 `adj`」走直角路由。
 * 选边复用 Step 7 `chooseSide`（以相邻拐点 `adj` 为「对端」参考——floating 按主轴朝 adj 选边、fixed 尊重
 * fixedPoint 所在边）；连接点垂直沿边投影（`orthoConnectionPoint`）；再 `routeOrthogonalToFreePoint` 折到 adj。
 * 返回 [连接点, ...派生拐点]（去掉末端 adj——adj 是中间拐点、由中间段提供，避免重复）。派生拐点不入库。
 */
function orthoTail(geo: ElementGeometry, binding: ArrowBinding, gap: number, adj: Vec): ArrowPoint[] {
  const side = chooseSide(geo.bbox, binding, { x: adj.x, y: adj.y, w: 0, h: 0 })
  const cp = orthoConnectionPoint(geo.bbox, binding.fixedPoint, side, gap)
  const tail = routeOrthogonalToFreePoint(cp, side, adj)
  return tail.slice(0, -1).map((p) => ({ x: p.x, y: p.y }))
}

/**
 * 解析后「渲染包围盒」（含 ARROW_PAD 外扩）——命中盒 / overlay / fit / 避让贴近判定的单一取盒口。
 * 绑定端点已由 resolver 贴到目标边，故此盒随目标移动/缩放跟随，不再错位到原始 points 坐标。
 * `doc` 缺席（无绑定挂载 / 遗留调用）时等价于 arrowRenderBounds（退回原 points）。
 */
export function resolveArrowBounds(doc: CanvasDoc | null, arrow: ArrowElement): Rect {
  return resolveArrowGeometry(doc, arrow).bounds
}

/**
 * 解析后「紧致线几何盒」（无 ARROW_PAD 外扩）——框选取盒用（完全框住才选中，外扩会让视觉框住却选不中）。
 * 取解析后 renderPoints 的紧致 AABB：绑定端点贴目标边后，框选按视觉真实位置判定、不再错位到原始坐标。
 */
export function resolveArrowTightBounds(doc: CanvasDoc | null, arrow: ArrowElement): Rect {
  return tightBoundsForPoints(resolveArrowGeometry(doc, arrow).renderPoints)
}

/**
 * auto→manual 就地冻结（设计 阶段2 §C §186）：把当前解析出的 renderPoints 固化进持久 points、routing 置
 * manual——「解析后固化」范式（同删除复合事务 STEP4 §174）。auto（收窄为两端直线）冻结后即两端连接点两点；
 * 已有派生拐点（阶段3）则一并含之。绑定字段不动（端点仍由 binding 派生、冻结值只作悬空 fallback），故冻结后
 * 形状与冻结前 render 完全等价、可继续编辑（拖拐点 / 加点 / 拖端点）。
 */
export function freezeAutoToManual(
  doc: CanvasDoc | null,
  arrow: ArrowElement,
): { points: ArrowPoint[]; routing: 'manual' } {
  const geo = resolveArrowGeometry(doc, arrow)
  return { points: geo.renderPoints.map((p) => ({ x: p.x, y: p.y })), routing: 'manual' }
}

/**
 * 拖 auto 直角箭头的**中间派生拐点** → 就地转 manual + 移动该拐点（设计 阶段3 §B §241-244）。
 * 先把当前解析形状（renderPoints，含 L/Z/C 派生拐点）原样固化为持久 points，再把 `renderIndex` 处的拐点
 * 移到 `point`——`renderIndex` 即 orthogonalGeometry 派生手柄的 index（= 冻结后该点在 points 中的下标），
 * 其余派生拐点原样保留（直角形状固化）。绑定字段由调用方保留（端点仍由 binding 派生）。
 * `renderIndex` 钳到中间区间 [1, points.length-2]（端点走重绑路径、不经此）。
 */
export function dragDerivedToManual(
  doc: CanvasDoc | null,
  arrow: ArrowElement,
  renderIndex: number,
  point: { x: number; y: number },
): { points: ArrowPoint[]; routing: 'manual' } {
  const frame = resolveArrowGeometry(doc, arrow).renderPoints
  const points = frame.map((p) => ({ x: p.x, y: p.y }))
  if (points.length >= 3) {
    const i = renderIndex < 1 ? 1 : renderIndex > points.length - 2 ? points.length - 2 : renderIndex
    points[i] = { x: point.x, y: point.y }
  }
  return { points, routing: 'manual' }
}

/**
 * 在渲染段 `segmentIndex`（连 renderPoints[i] 与 renderPoints[i+1]）中插入一个拐点 `point` → 新持久 points
 * （设计 阶段2 §C §183 加拐点；auto 遇此就地转 manual §186）。
 *
 * 以当前 renderPoints 为冻结基底（解析后固化范式）：段 i 的新点插在持久数组 index i+1 处。
 * - auto（2 点、单段 0）→ [start连接点, point, end连接点]、routing='manual'。
 * - manual（n 点、段 i∈[0,n-2]）→ 在第 i 段中插入，端点固化为当前连接点、中间拐点保持。
 * segmentIndex 越界钳到合法区间（防御，UI 只传合法段）。绑定字段由调用方保留（端点仍由 binding 派生）。
 */
export function insertWaypoint(
  doc: CanvasDoc | null,
  arrow: ArrowElement,
  segmentIndex: number,
  point: { x: number; y: number },
): { points: ArrowPoint[]; routing: 'manual' } {
  const frame = resolveArrowGeometry(doc, arrow).renderPoints
  const maxSeg = Math.max(0, frame.length - 2)
  const i = segmentIndex < 0 ? 0 : segmentIndex > maxSeg ? maxSeg : segmentIndex
  const points: ArrowPoint[] = [
    ...frame.slice(0, i + 1).map((p) => ({ x: p.x, y: p.y })),
    { x: point.x, y: point.y },
    ...frame.slice(i + 1).map((p) => ({ x: p.x, y: p.y })),
  ]
  return { points, routing: 'manual' }
}

/**
 * 删除一个中间拐点（`index` 为持久下标；设计 阶段2 §C §184）。首 / 末端点不可删 → 返回 null（调用方据此
 * 转「删整根箭头」）。删除后 points 长度 ≥2（原中间点存在即 ≥3），routing 不变（拐点仅存在于 manual）。
 */
export function deleteWaypoint(
  arrow: ArrowElement,
  index: number,
): { points: ArrowPoint[] } | null {
  const n = arrow.points.length
  if (index <= 0 || index >= n - 1) return null // 端点不可删
  const points = arrow.points.filter((_, i) => i !== index).map((p) => ({ x: p.x, y: p.y }))
  return { points }
}

/** 按 `binding.elementId` 在 doc 中解析目标几何；找不到 / 不可绑 / 未 measured → null（降级由调用方处理） */
function bindingTargetGeometry(doc: CanvasDoc, binding: ArrowBinding | null): ElementGeometry | null {
  if (!binding) return null
  const target = doc.elements.find((e) => e.id === binding.elementId)
  if (!target) return null
  return elementGeometry(target)
}

/**
 * 绑定端连接点（按 mode 分流；目标不可解析 geo/anchor 缺席 → null，调用方降级为原端点坐标）：
 * - **floating（磁吸）**：从「对端参考点」`from` 射向锚点 `anchor`，取与外扩 `gap` 轮廓的入边交点
 *   （orbit 贴边）——连接点随对端方向滑到最近边、随目标移动换边。求交空（对端也在内侧 / 平行无交）→ null。
 * - **fixed（精确）**：把锚点投影到外扩轮廓（`closestPointOnContour`）——连接点咬死锚点所在边、
 *   独立于对端方向，不随对端换边。锚点由 fixedPoint 落在边缘带得来，投影即该边外 gap 处。
 */
function connectionPoint(
  geo: ElementGeometry | null,
  anchor: Vec | null,
  from: Vec,
  gap: number,
  mode: 'floating' | 'fixed',
): Vec | null {
  if (!geo || !anchor) return null
  const inflated = contourInflate(geo.contour, gap)
  if (mode === 'fixed') return closestPointOnContour(inflated, anchor)
  const hits = segmentContourIntersections(inflated, from, anchor)
  return hits[0] ?? null
}

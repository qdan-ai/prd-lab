/**
 * 箭头 SVG 路径构造（纯函数，设计 §阶段1 渲染）。
 * - 折线：M + 连续 L。
 * - 曲线（curved 且 ≥3 点）：Catmull-Rom 经过各点，转三次贝塞尔 C；张力 0.5（标准 Catmull-Rom）。
 * - 少于 2 点无意义，返回空串（调用方据此不渲染路径）。
 */
export interface PathPoint {
  x: number
  y: number
}

export function buildArrowPath(points: PathPoint[], curved = false): string {
  if (points.length < 2) return ''
  if (!curved || points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  }
  return catmullRomPath(points)
}

/**
 * Catmull-Rom 样条转三次贝塞尔。对每一段 [p1,p2]，用相邻控制点 p0/p3 推出两个贝塞尔控制柄。
 * 端点段复制端点自身作虚拟邻点（保端点经过、不外飘）。
 */
function catmullRomPath(pts: PathPoint[]): string {
  const n = pts.length
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return d
}

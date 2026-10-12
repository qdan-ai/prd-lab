/**
 * ArrowView —— 箭头渲染器（设计 §2.1 / §2.3）
 *
 * 逐箭头独立 SVG（不集中渲染、不特殊置顶）：
 * - 点 / 包围盒统一由 resolveArrowGeometry 出（单一真相源），SVG 定位于渲染盒。
 * - 盒内坐标 = 世界坐标 − 盒左上角；SVG <path> 折线/曲线 + 端头 marker。
 * - 标签为线中点的 DOM 元素（回避 foreignObject——字体渲染与选中态后续做 DOM 更顺）。
 *
 * 与 ElementLayer 的特殊约定：箭头自带绝对定位（SVG 盒整体定位到包围盒左上角），
 * 故 ElementLayer 对 arrow 不再叠加 left/top（见 ElementLayer 注释）。
 */
import { useId } from 'react'
import type { ArrowElement, CanvasDoc } from '../../../engine/schema'
import { normalizeArrowForRender, resolveArrowGeometry } from '../../../engine/arrow-geometry'
import { buildArrowPath } from './arrow-path'

/**
 * 箭头透明 hit 区线宽（命中容差，M1 / D2）：12 → 20。半幅 10px 落在渲染盒的
 * ARROW_PAD(16) 之内，不溢出渲染盒、不抢命中邻接元素，又显著扩大了 frame 内点箭头的命中带。
 */
const ARROW_HIT_WIDTH = 20

export function ArrowView({ el, doc = null }: { el: ArrowElement; doc?: CanvasDoc | null }) {
  // 单一真相源：点 / 包围盒统一由 resolver 出。传真实 doc 使绑定端点求交贴到目标边；
  // doc 缺省 null（无绑定的挂载 / 冒烟测试）时 resolver 退回原 points，行为不变。
  const geo = resolveArrowGeometry(doc, el)
  const style = normalizeArrowForRender(el)
  const bounds = geo.bounds
  // 世界坐标 → SVG 盒本地坐标（盒左上角为原点）
  const local = geo.renderPoints.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))
  const d = buildArrowPath(local, style.curved)
  // marker id 必须每实例唯一，否则多箭头共享 defs 会串色/串形
  const markerId = useId().replace(/:/g, '_') + '-arrowhead'
  const startMarkerId = markerId + '-start'

  // 线型 → dasharray（随 strokeWidth 缩放，粗线虚段同比放大才协调）
  const dashArray =
    style.strokeStyle === 'dashed' ? `${style.strokeWidth * 3} ${style.strokeWidth * 2}`
    : style.strokeStyle === 'dotted' ? `${style.strokeWidth} ${style.strokeWidth * 2}`
    : undefined
  // dotted 用圆头才是「点」，否则 SVG 默认 butt 会把点线渲染成短方块虚线
  const lineCap = style.strokeStyle === 'dotted' ? 'round' : undefined

  const start = local[0]!
  const end = local[local.length - 1]!
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const hasLabel = el.label != null && el.label !== ''

  return (
    // data-hc-id / data-hc-type：hit-test.ts hitElementId 沿 composedPath 向上找此属性返回命中 id。
    // 整体 pointerEvents:'none' 保证包围盒内大片透明区不遮挡下层元素；
    // 可命中区由 SVG 内透明加粗 hit path（pointerEvents:'stroke'）+ label span（pointerEvents:'auto'）承载，
    // 命中时事件 target 在内层，composedPath 向上仍经过本 div，hitElementId 即可取到 el.id。
    <div
      className="hc-arrow"
      data-hc-id={el.id}
      data-hc-type="arrow"
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.w,
        height: bounds.h,
        // 让标签可超出 SVG 盒而不被裁（盒已含标签余量，这里只是兜底）
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <svg
        width={bounds.w}
        height={bounds.h}
        viewBox={`0 0 ${bounds.w} ${bounds.h}`}
        style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      >
        <defs>
          {/* 终点端头：refX=8 让三角尖端落在路径终点；triangle=实心三角、arrow=开口 V。
              orient="auto" 使端头随线尾切线朝向自动旋转（无论箭头指向哪个方向都尖端朝外）。*/}
          {style.endArrowhead !== 'none' && (
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="3"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {style.endArrowhead === 'triangle' ? (
                <path d="M0,0 L8,3 L0,6 Z" fill={style.strokeColor} />
              ) : (
                <path d="M0,0 L8,3 L0,6" fill="none" stroke={style.strokeColor} strokeWidth={1} />
              )}
            </marker>
          )}
          {/* 起点端头：形状左右镜像 + refX=0，让尖端落在路径起点、指向线外。*/}
          {style.startArrowhead !== 'none' && (
            <marker
              id={startMarkerId}
              markerWidth="10"
              markerHeight="10"
              refX="0"
              refY="3"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {style.startArrowhead === 'triangle' ? (
                <path d="M8,0 L0,3 L8,6 Z" fill={style.strokeColor} />
              ) : (
                <path d="M8,0 L0,3 L8,6" fill="none" stroke={style.strokeColor} strokeWidth={1} />
              )}
            </marker>
          )}
        </defs>
        {/* 透明加粗 hit 区（命中容差，M1 / D2）：覆盖同一路径，stroke:transparent +
            pointerEvents:'stroke' 让细线周围范围内的点击能命中，事件 target 仍在 svg 内部，
            composedPath 向上经过带 data-hc-id 的外层 div，hitElementId 返回 el.id。
            jsdom 无指针事件模拟，此行为由主会话 e2e 真浏览器验证。 */}
        <path d={d} fill="none" stroke="transparent" strokeWidth={ARROW_HIT_WIDTH} style={{ pointerEvents: 'stroke' }} />
        {/* 可见线：同路径，细描边 + 数据驱动的线型（实/虚/点）+ 首尾端头。
            默认（solid / start=none / end=triangle）下 dashArray/lineCap/markerStart 均为
            undefined，视觉与旧版一致。*/}
        <path
          d={d}
          fill="none"
          stroke={style.strokeColor}
          strokeWidth={style.strokeWidth}
          strokeDasharray={dashArray}
          strokeLinecap={lineCap}
          markerStart={style.startArrowhead !== 'none' ? `url(#${startMarkerId})` : undefined}
          markerEnd={style.endArrowhead !== 'none' ? `url(#${markerId})` : undefined}
          style={{ pointerEvents: 'stroke' }}
        />
      </svg>
      {hasLabel && (
        <span
          className="hc-arrow-label"
          style={{
            position: 'absolute',
            left: midX,
            top: midY,
            // 标签盒以中点为锚居中
            transform: 'translate(-50%, -50%)',
            // pointerEvents:'auto' 让点标签也能选中箭头（事件冒泡到外层 div 携带 data-hc-id）
            pointerEvents: 'auto',
          }}
        >
          {el.label}
        </span>
      )}
    </div>
  )
}

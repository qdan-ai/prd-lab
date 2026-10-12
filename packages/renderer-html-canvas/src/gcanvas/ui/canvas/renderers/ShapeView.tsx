/**
 * ShapeView —— 形状渲染器（设计 §2.3）
 *
 * 两种形状：
 * - rect：圆角矩形 div
 * - diamond：CSS clip-path polygon 裁成菱形
 * 文字（可选）居中，溢出收缩（白边内，长文不撑破形状）。
 *
 * 注意：本组件只画形状本体，不含定位 wrapper——定位（position:absolute + left/top）
 * 由 ElementLayer 统一加（wrapper CSS 白名单纪律）。
 */
import type { ShapeElement } from '../../../engine/schema'

export function ShapeView({ el }: { el: ShapeElement }) {
  const isDiamond = el.shape === 'diamond'
  return (
    <div
      className={'hc-shape ' + (isDiamond ? 'hc-shape-diamond' : 'hc-shape-rect')}
      style={{
        width: el.w,
        height: el.h,
        // diamond 用 clip-path 裁形；rect 走圆角（见 styles/canvas-engine.css 的 .hc-shape-rect）
        clipPath: isDiamond ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : undefined,
      }}
    >
      {el.text != null && el.text !== '' && (
        <span className="hc-shape-text">{el.text}</span>
      )}
    </div>
  )
}

/**
 * ImageView —— 图片渲染器（设计 §2.3）
 *
 * <img src={adapter.assetUrl(boardId, src)}> 定宽高、draggable=false
 * （拖拽手势留交互 sprint，此处先禁浏览器原生图片拖拽，避免与画布平移打架）。
 * 定位 wrapper 由 ElementLayer 统一加（白名单纪律）。
 */
import type { ImageElement } from '../../../engine/schema'
import { useCanvasContext } from '../canvas-context'

export function ImageView({ el }: { el: ImageElement }) {
  const { adapter, boardId, resourceEpoch } = useCanvasContext()
  // assetUrl 同步拼 URL（画板根视角路径原样映射），<img> 直用
  // resourceEpoch>0 时拼版本 query 做 cache-bust（asset 外部变更后强制重取，设计 §2.6）
  const base = adapter.assetUrl(boardId, el.src)
  const src = resourceEpoch > 0 ? `${base}${base.includes('?') ? '&' : '?'}v=${resourceEpoch}` : base
  return (
    <img
      className="hc-image"
      src={src}
      width={el.w}
      height={el.h}
      draggable={false}
      alt=""
    />
  )
}

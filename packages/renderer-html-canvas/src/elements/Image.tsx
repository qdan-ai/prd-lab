/**
 * Image 渲染器（只读版）
 */
import type { ImageElement } from '../schema'

type Props = {
  element: ImageElement
  baseUrl: string
  style?: React.CSSProperties
}

export function Image({ element, baseUrl, style }: Props) {
  const src = `${baseUrl}/${element.src}`
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        ...style,
        width: element.w,
        height: element.h,
        objectFit: 'cover',
      }}
    />
  )
}

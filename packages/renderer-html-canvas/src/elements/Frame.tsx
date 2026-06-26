/**
 * Frame 渲染器（只读版）
 */
import type { FrameElement } from '../schema'
import type { ReactNode } from 'react'

type Props = {
  element: FrameElement
  style?: React.CSSProperties
  children?: ReactNode
}

export function Frame({ element, style, children }: Props) {
  return (
    <div
      style={{
        ...style,
        width: element.w,
        height: element.h,
        border: '1px solid #ccc',
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          fontSize: 12,
          color: '#666',
          marginBottom: 4,
          whiteSpace: 'nowrap',
        }}
      >
        {element.name}
      </div>
      {children}
    </div>
  )
}

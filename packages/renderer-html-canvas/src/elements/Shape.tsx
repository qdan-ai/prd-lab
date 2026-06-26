/**
 * Shape 渲染器（只读版）
 */
import type { ShapeElement } from '../schema'

type Props = {
  element: ShapeElement
  style?: React.CSSProperties
}

export function Shape({ element, style }: Props) {
  const isDiamond = element.shape === 'diamond'
  return (
    <div
      style={{
        ...style,
        width: element.w,
        height: element.h,
        backgroundColor: '#f0f0f0',
        border: '2px solid #333',
        borderRadius: isDiamond ? 0 : 8,
        clipPath: isDiamond ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
        overflow: 'hidden',
      }}
    >
      {element.text && (
        <span style={{ fontSize: 14, textAlign: 'center', wordBreak: 'break-word' }}>
          {element.text}
        </span>
      )}
    </div>
  )
}

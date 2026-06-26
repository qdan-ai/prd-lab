/**
 * Arrow 渲染器（只读版）
 */
import type { ArrowElement } from '../schema'

type Props = {
  element: ArrowElement
  style?: React.CSSProperties
}

export function Arrow({ element, style }: Props) {
  const x1 = element.x1
  const y1 = element.y1
  const x2 = element.x2
  const y2 = element.y2

  // 计算包围盒
  const minX = Math.min(x1, x2)
  const minY = Math.min(y1, y2)
  const maxX = Math.max(x1, x2)
  const maxY = Math.max(y1, y2)
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)

  // SVG 内部坐标（相对于包围盒）
  const localX1 = x1 - minX
  const localY1 = y1 - minY
  const localX2 = x2 - minX
  const localY2 = y2 - minY

  // 标签位置（中点）
  const midX = (localX1 + localX2) / 2
  const midY = (localY1 + localY2) / 2

  return (
    <div
      style={{
        ...style,
        position: 'absolute',
        left: minX,
        top: minY,
        width,
        height,
        overflow: 'visible',
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <marker
            id={`arrow-${element.id}`}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L8,3 L0,6 Z" fill="#333" />
          </marker>
        </defs>
        <line
          x1={localX1}
          y1={localY1}
          x2={localX2}
          y2={localY2}
          stroke="#333"
          strokeWidth={2}
          markerEnd={`url(#arrow-${element.id})`}
        />
      </svg>
      {element.label && (
        <span
          style={{
            position: 'absolute',
            left: midX,
            top: midY,
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'white',
            padding: '2px 4px',
            fontSize: 12,
            whiteSpace: 'nowrap',
          }}
        >
          {element.label}
        </span>
      )}
    </div>
  )
}

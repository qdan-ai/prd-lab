/**
 * Canvas —— 无限画布容器（只读渲染）
 *
 * 渲染策略（对齐 html_canvas ElementLayer，**非** spec §3.2 示例的 frame 嵌套）：
 *   所有元素一律平铺，按 elements 数组序渲染（DOM 序 = 图层序，不用 z-index）。
 *   子元素坐标恒为世界坐标，parent 仅组织归属——Frame 是半透明背景矩形，子元素因世界
 *   坐标落在 frame 区域内、且数组序在 frame 之后，视觉上才"在 frame 里"。
 *   绝不把子元素嵌进 frame 的定位容器（否则世界坐标被 frame 的 left/top 二次偏移）。
 *
 * 交互（决策 D6 完整交互）：滚轮缩放 + 空格拖拽 + 键盘快捷键（Cmd+0/=/-），由 useCamera 提供。
 * 初始 fitToContent 由 useCamera 首屏门控完成。
 *
 * camera 形态：{ tx, ty, zoom }，CSS = translate(tx,ty) scale(zoom)，transformOrigin 0 0。
 */
import { useMemo } from 'react'
import { HtmlBlock } from './elements/HtmlBlock'
import { Shape } from './elements/Shape'
import { Text } from './elements/Text'
import { Image } from './elements/Image'
import { Arrow } from './elements/Arrow'
import { Frame } from './elements/Frame'
import { useCamera } from './use-camera'
import { collectBounds } from './bounds'
import type { BoardData, CanvasElement } from './types'

type Props = {
  board: BoardData
  baseUrl: string
}

export function Canvas({ board, baseUrl }: Props) {
  // 包围盒只依赖元素数组，记忆化避免每渲染重算
  const bounds = useMemo(() => collectBounds(board.elements), [board.elements])
  const {
    camera,
    spaceDown,
    panning,
    viewportRef,
    onPanPointerDown,
    onPanPointerMove,
    onPanPointerUp,
  } = useCamera(bounds)

  // CSS transform 手动组装（camera.ts 无 applyCamera 函数，P0-2）
  const transform = `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.zoom})`

  // 光标：空格按住 = grab，拖动中 = grabbing，否则默认
  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : 'default'

  return (
    <div
      ref={viewportRef}
      onPointerDown={onPanPointerDown}
      onPointerMove={onPanPointerMove}
      onPointerUp={onPanPointerUp}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        background: '#f5f5f5',
        cursor,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform,
        }}
      >
        {board.elements.map((el) => renderElement(el, baseUrl))}
      </div>
    </div>
  )
}

/** 单元素渲染：arrow 自定位（端点坐标非 x/y），其余五类套 left/top wrapper */
function renderElement(el: CanvasElement, baseUrl: string) {
  if (el.type === 'arrow') {
    return <Arrow key={el.id} element={el} />
  }
  return (
    <div
      key={el.id}
      style={{ position: 'absolute', left: el.x, top: el.y }}
    >
      {renderBody(el, baseUrl)}
    </div>
  )
}

/** 按 type 分派到具体渲染器（arrow 已在上层单独处理） */
function renderBody(el: Exclude<CanvasElement, { type: 'arrow' }>, baseUrl: string) {
  switch (el.type) {
    case 'html':
      return <HtmlBlock element={el} baseUrl={baseUrl} />
    case 'shape':
      return <Shape element={el} />
    case 'text':
      return <Text element={el} />
    case 'image':
      return <Image element={el} baseUrl={baseUrl} />
    case 'frame':
      return <Frame element={el} />
  }
}

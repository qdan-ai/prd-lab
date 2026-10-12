/**
 * ElementLayer 改写件（PRD-Lab 自有，对应上游 ui/canvas/ElementLayer.tsx）—— 只读子集
 *
 * 与上游一致的部分（DOM 契约，对照脚本按 [data-hc-id] 与 .hc-world 的 transform 导出几何）：
 * - 六类元素严格按 elements 数组序渲染：DOM 序 = 图层序，不用 z-index，箭头不特殊置顶。
 * - 非箭头元素外层 wrapper：`div.hc-el[data-hc-id][data-hc-type]`，style 仅 position:absolute + left/top。
 * - 箭头自定位：ArrowView 自带 data-hc-id / data-hc-type 与绝对定位，不套 wrapper。
 *
 * 只读裁剪：去掉拖动 / 编辑 / 样式预览、就地编辑替换、拖入落点高亮（查看器无这些交互）。
 * 查看器扩展：画不了的元素（未接入的类型、不符合 G-canvas 格式的数据，见 known-elements）渲染占位卡，
 * wrapper 契约同上。
 */
import type { CanvasDoc, CanvasElement } from '../../engine/schema'
import { ShapeView } from './renderers/ShapeView'
import { TextView } from './renderers/TextView'
import { ImageView } from './renderers/ImageView'
import { FrameView } from './renderers/FrameView'
import { ArrowView } from './renderers/ArrowView'
import { HtmlBlockView } from './renderers/HtmlBlockView'
import { UnknownElementView } from '../../../UnknownElementView'
import { elementStatus, placeholderRect, type UnknownElement } from '../../../known-elements'

export function ElementLayer({
  elements,
  doc,
}: {
  /** 画板全部元素（可含画不了的元素），按数组序渲染 */
  elements: readonly unknown[]
  /** 只含可渲染元素的文档：供 ArrowView 按箭头 binding 解析目标几何 */
  doc: CanvasDoc
}) {
  return (
    <>
      {elements.map((raw, i) => {
        const status = elementStatus(raw)
        if (status.kind !== 'rendered') {
          return <PlaceholderWrapper key={keyOf(raw, i)} el={(raw ?? {}) as UnknownElement} status={status} />
        }
        const el = status.el
        if (el.type === 'arrow') return <ArrowView key={el.id} el={el} doc={doc} />
        return (
          <div
            key={el.id}
            className="hc-el"
            data-hc-id={el.id}
            data-hc-type={el.type}
            style={{ position: 'absolute', left: el.x, top: el.y }}
          >
            <ElementBody el={el} />
          </div>
        )
      })}
    </>
  )
}

/** 按 type 分派到具体渲染器（arrow 已在上层单独处理）。上游新增类型时 never 分支类型检查报错 */
function ElementBody({ el }: { el: Exclude<CanvasElement, { type: 'arrow' }> }) {
  switch (el.type) {
    case 'html':
      return <HtmlBlockView el={el} />
    case 'shape':
      return <ShapeView el={el} />
    case 'text':
      return <TextView el={el} />
    case 'image':
      return <ImageView el={el} />
    case 'frame':
      return <FrameView el={el} />
    default: {
      const unreachable: never = el
      return unreachable
    }
  }
}

function PlaceholderWrapper({
  el,
  status,
}: {
  el: UnknownElement
  status: Exclude<ReturnType<typeof elementStatus>, { kind: 'rendered' }>
}) {
  const rect = placeholderRect(el)
  return (
    <div
      className="hc-el"
      data-hc-id={typeof el.id === 'string' ? el.id : undefined}
      data-hc-type={status.type}
      style={{ position: 'absolute', left: rect.x, top: rect.y }}
    >
      <UnknownElementView
        kind={status.kind}
        type={status.type}
        reason={status.kind === 'invalid' ? status.reason : undefined}
        w={rect.w}
        h={rect.h}
      />
    </div>
  )
}

function keyOf(el: unknown, index: number): string {
  const id = (el as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : `__unknown-${index}`
}

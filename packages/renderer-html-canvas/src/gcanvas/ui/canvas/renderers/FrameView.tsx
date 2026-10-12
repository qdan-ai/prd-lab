/**
 * FrameView —— Frame 容器渲染器（设计 §2.3）
 *
 * 半透明底矩形 + 1px 边界；标题在框外左上（Figma 惯例），
 * 字号随 zoom 反向补偿（font-size: 12/zoom px）保持屏幕恒定大小
 * ——"位置跟随、尺寸恒定"模式承袭旧项目锚点 pin 决策 D2（设计 §8）。
 *
 * 常驻标题即 frame 的标题热区（M1 / D3）：打 data-hc-title（属性值=元素 id），
 * 点/拖标题 = 选中并拖动该 frame、双击 = 改名、右键 = 操作该 frame——与五类元素选中态
 * 的 overlay 标题同一交互模型（frame 选中时 SelectionOverlay 不再另渲标题，避免双标题）。
 *
 * Frame 在数组前部 → DOM 序在子元素之前 → 天然画在子元素下方（schema 校验保证此约束）。
 * 标题是普通文本（非弹层），无浮层裁剪风险（R-7），可留在 transform 容器内（设计 §2.3）。
 * 定位 wrapper 由 ElementLayer 统一加（白名单纪律）。
 */
import type { FrameElement } from '../../../engine/schema'
import { useCanvasContext } from '../canvas-context'

export function FrameView({ el, highlighted }: { el: FrameElement; highlighted?: boolean }) {
  const { zoom } = useCanvasContext()
  // 标题字号反向补偿：缩放越小字越大，抵消 .hc-world 的 scale，屏幕上恒定 ~12px。
  // 标题挂在框外左上：用 bottom:100% 把标题盒推到 frame 顶边之上，无需知道行高。
  const titleFontSize = 12 / zoom
  // 高亮态（拖入落点提示，设计 D8）：边框/底色加重，纯 UI 态。边框宽随 zoom 反向补偿恒定屏幕粗细。
  return (
    <div
      className={'hc-frame' + (highlighted ? ' is-drop-target' : '')}
      data-drop-target={highlighted ? '' : undefined}
      style={{
        width: el.w,
        height: el.h,
        ...(highlighted ? { borderWidth: 2 / zoom } : null),
      }}
    >
      {/* 标题热区：可交互（pointer-events:auto，见 .hc-frame-title）。max-width 随 zoom
          反向补偿（与字号同策略），屏幕上恒定 ~240px 截断超长名（与 .hc-overlay-title 对齐）。 */}
      <div
        className="hc-frame-title"
        data-hc-title={el.id}
        style={{ fontSize: titleFontSize, maxWidth: 240 / zoom }}
      >
        {el.name}
      </div>
    </div>
  )
}

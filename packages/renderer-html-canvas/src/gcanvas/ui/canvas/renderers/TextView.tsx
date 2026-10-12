/**
 * TextView —— 文字静态渲染器（D3：非编辑态轻量渲染，仅编辑中的那一个挂 Tiptap）
 *
 * - 内容 = Markdown：经内核 renderStaticMarkdown（与编辑侧同装配同解析路径 + sanitize）
 *   渲染为 HTML 注入。`.hc-md` 内容样式类与编辑器 ProseMirror 共用（无视觉跳变）。
 * - 整框级外观：textFrameStyle 把 schema 字段套成容器 CSS（与编辑外层同一换算）。
 * - 双宽度模式（D4）：无 width 自动宽（max-content）/ 有 width 固定宽（换行高自适应）。
 * - measured 写回：首渲/内容变更后实测 offset 盒经 ctx.setMeasured 落缓存（与 html 块
 *   同源门控——active 门控在 CanvasPage.setMeasured；store 同尺寸 no-op），供视口剔除
 *   与包围盒取真实渲染盒。
 * 定位 wrapper 由 ElementLayer 统一加（白名单纪律）。
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { TextElement } from '../../../engine/schema'
import { renderStaticMarkdown } from '../../editor-kernel'
import { useCanvasContext } from '../canvas-context'
import { textFrameStyle } from './text-style'

export function TextView({ el }: { el: TextElement }) {
  const { setMeasured } = useCanvasContext()
  const ref = useRef<HTMLDivElement>(null)

  // dangerouslySetInnerHTML 的 {__html} 包装对象必须 memo 化：react-dom 按**对象引用**
  // 比较该 prop（非 __html 字符串值），每渲染新建包装对象会让 React 每次重设 innerHTML
  // ——子节点被整换导致浏览器取消 dblclick 合成（双击进编辑彻底失灵）+ 白费排版。
  const html = useMemo(
    () => ({ __html: renderStaticMarkdown('light', el.text) }),
    [el.text],
  )
  const style = useMemo(() => textFrameStyle(el), [el])

  // 实测写回：排版相关输入（内容 html / 外观 style）变化后量 offset 盒
  // （jsdom 量出 0 → 不写，回退估算路径不受扰；同尺寸由 store no-op）
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const w = node.offsetWidth
    const h = node.offsetHeight
    if (w > 0 && h > 0) setMeasured(el.id, { w, h })
  }, [html, style, el.id, setMeasured])

  return (
    <div
      ref={ref}
      className="hc-text hc-md"
      style={style}
      // 内容已经 sanitizeHtml（renderStaticMarkdown 内）清洗
      dangerouslySetInnerHTML={html}
    />
  )
}
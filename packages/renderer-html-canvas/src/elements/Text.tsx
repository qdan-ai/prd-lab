/**
 * Text 渲染器（只读版，简化版 Markdown 渲染）
 */
import type { TextElement } from '../schema'

type Props = {
  element: TextElement
  style?: React.CSSProperties
}

export function Text({ element, style }: Props) {
  // 简化版 Markdown 渲染：直接显示纯文本
  // 实际项目中应该用 markdown 库渲染
  const containerStyle: React.CSSProperties = {
    ...style,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
    color: element.color,
    textAlign: element.textAlign,
    lineHeight: element.lineHeight,
    textDecoration: element.underline ? 'underline' : undefined,
    width: element.width,
    whiteSpace: element.width ? 'pre-wrap' : 'nowrap',
    wordBreak: element.width ? 'break-word' : undefined,
  }

  return (
    <div style={containerStyle}>
      {element.text}
    </div>
  )
}

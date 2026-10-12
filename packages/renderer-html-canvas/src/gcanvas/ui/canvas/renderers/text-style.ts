/**
 * TextElement 整框级外观 → CSS（D1/D4）
 *
 * 单一换算真相源：静态渲染（TextView）、就地编辑（CanvasTextEditor 外层）、离屏测量
 * （text-measure）三处共用，保证「编辑态↔静态态↔测量」三侧样式一致（无视觉跳变的前提）。
 *
 * 宽度策略（D4 双宽度模式 + R-9 零尺寸容器显式声明）：
 * - 画布世界容器 .hc-world 是 0×0 盒，绝对定位 wrapper 的 shrink-to-fit 在零可用宽下
 *   会塌缩成 min-content（竖排折行）——text 容器**必须显式给宽**，禁依赖环境宽度。
 * - 无 width（自动宽）：width: max-content——随内容变宽、仅硬换行折行。
 * - 有 width（固定宽）：width: 定值 px + 长词折行（overflowWrap）——换行、高自适应。
 *
 * 字段值信任边界：color/fontFamily 已经 schema 层字符级白名单清洗（防 CSS 注入），
 * 此处按值直套；新值产生入口（工具栏）用受控控件约束形态。
 */
import type { CSSProperties } from 'react'
import type { TextElement } from '../../../engine/schema'

/** 外观字段子集（编辑期 transient 预览与 el 合并后也走同一换算） */
export interface TextFrameStyleFields {
  fontSize: number
  fontFamily?: string | undefined
  color?: string | undefined
  textAlign?: 'left' | 'center' | 'right' | undefined
  lineHeight?: number | undefined
  underline?: boolean | undefined
  width?: number | undefined
}

/**
 * 「字段是否存在」用 Object.hasOwn 判自有属性（R-3）——与 schema 校验同口径，
 * 防原型链上的同名字段（如继承的 width/color）被误当作元素自身外观读出。
 */
function has(el: TextFrameStyleFields, key: keyof TextFrameStyleFields): boolean {
  return Object.hasOwn(el, key) && el[key] !== undefined
}

/** TextElement（或编辑预览合并后的字段集）→ 容器 CSS */
export function textFrameStyle(el: TextFrameStyleFields): CSSProperties {
  const hasWidth = has(el, 'width')
  const style: CSSProperties = {
    fontSize: el.fontSize,
    // 宽度策略（R-9）：恒显式——自动宽 max-content / 固定宽定值
    width: hasWidth ? el.width : 'max-content',
  }
  if (hasWidth) {
    // 固定宽：允许长词/长 URL 在框内折行（否则溢出框外，边界框包不住）
    style.overflowWrap = 'break-word'
  }
  if (has(el, 'fontFamily')) style.fontFamily = el.fontFamily
  if (has(el, 'color')) style.color = el.color
  if (has(el, 'textAlign')) style.textAlign = el.textAlign
  if (has(el, 'lineHeight')) style.lineHeight = el.lineHeight
  if (el.underline) style.textDecoration = 'underline'
  return style
}

/** 从 TextElement 提取外观字段（与编辑期 patch 合并的基础） */
export function frameStyleFieldsOf(el: TextElement): TextFrameStyleFields {
  return {
    fontSize: el.fontSize,
    fontFamily: el.fontFamily,
    color: el.color,
    textAlign: el.textAlign,
    lineHeight: el.lineHeight,
    underline: el.underline,
    width: el.width,
  }
}

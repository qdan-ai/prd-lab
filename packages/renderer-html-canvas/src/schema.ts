/**
 * board/v1 文档模型 —— 六元素 schema（设计依据：ai/specs v1 设计定稿 §1）
 *
 * 契约文件：前后端共同依赖的类型真相源。
 */

export const BOARD_FORMAT = 'board/v1'

/** 实测尺寸缓存（首渲写回，与用户编辑数据分离，供视口剔除预判与挂载前占位） */
export interface MeasuredSize {
  w: number
  h: number
}

interface ElementBase {
  id: string
  /** 归属 Frame 的 id；缺省 = 自由散落。子元素坐标恒为世界坐标，parent 仅组织归属 */
  parent?: string
}

/**
 * 元素标题（图层名）= 用户可重命名的展示标签，独立于元素自身内容
 * （shape.text / arrow.label / text 正文 / html 文件名）。
 * html/shape/text/image/arrow 五类各持一份可选 name（frame 用其自有的必填 name）；
 * 允许空串（清空 = 回退到占位标题，见 SelectionOverlay.elementLabel）。
 */
type NamedElement = { name?: string }

/** HTML 块：一屏/一组件 = 一个独立文件，真 HTML 渲染（双形态标准见设计 §1.3） */
export interface HtmlElement extends ElementBase, NamedElement {
  type: 'html'
  x: number
  y: number
  /** blocks/ 下的文件名 */
  file: string
  /** 形态②共享样式块：按序生效的 styles/ 相对路径；形态①自包含块为空/缺省 */
  css?: string[]
  /** 不记 w/h（自然尺寸）；首渲实测写回此缓存字段 */
  measured?: MeasuredSize
}

export interface ShapeElement extends ElementBase, NamedElement {
  type: 'shape'
  shape: 'diamond' | 'rect'
  x: number
  y: number
  w: number
  h: number
  text?: string
}

export interface TextElement extends ElementBase, NamedElement {
  type: 'text'
  x: number
  y: number
  /** 内容 = Markdown（GFM 子集：加粗/斜体/删除线/有序无序列表/高亮） */
  text: string
  /** 基准字号 */
  fontSize: number
  // —— 整框级外观（D1：颜色/字体/对齐/行高/下划线不进 Markdown，作为字段套进容器 CSS）——
  /** CSS font-family 值（字符级白名单清洗后落盘） */
  fontFamily?: string
  /** CSS color 值（字符级白名单清洗后落盘） */
  color?: string
  /** 文本对齐（枚举白名单） */
  textAlign?: 'left' | 'center' | 'right'
  /** 行高倍数（无单位正数，设合理上限防排版炸裂） */
  lineHeight?: number
  /** 整框下划线开关（纯 Markdown 无逐字下划线干净语法，故整框级） */
  underline?: boolean
  /** 有=固定宽（按宽换行、高自适应）；无=自动宽（随内容变宽不换行） */
  width?: number
  /** 首渲实测写回缓存（与 html 同源门控；供视口剔除与包围盒取真实渲染盒） */
  measured?: MeasuredSize
}

export interface ImageElement extends ElementBase, NamedElement {
  type: 'image'
  x: number
  y: number
  /** assets/ 相对路径（画板根目录视角） */
  src: string
  w: number
  h: number
}

/** 箭头：两点连线 + 标签；from/to 为 v2 绑定预留字段，v1 恒 null */
export interface ArrowElement extends ElementBase, NamedElement {
  type: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  from: string | null
  to: string | null
}

/** Frame 容器：命名 + 视觉边界 + 整体拖动（v1 不嵌套、不裁剪、不自动布局） */
export interface FrameElement extends ElementBase {
  type: 'frame'
  name: string
  x: number
  y: number
  w: number
  h: number
}

export type CanvasElement =
  | HtmlElement
  | ShapeElement
  | TextElement
  | ImageElement
  | ArrowElement
  | FrameElement

export type ElementType = CanvasElement['type']

/** canvas.json 整体形态。elements 数组顺序 = 图层序 */
export interface CanvasDoc {
  title: string
  format: typeof BOARD_FORMAT
  elements: CanvasElement[]
}

// ---------------------------------------------------------------------------
// 校验：AI 会直接生成 canvas.json，启动时必须校验并报可读错误（评审定稿）
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean
  /** 可读错误，指明哪个元素哪个字段，如 `elements[3] (id=s1): shape 缺少 w` */
  errors: string[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * 安全相对路径（评审 P1-3：路径契约的 schema 层防线，与服务端 realpath 防线构成双重防御）：
 * 相对路径、无反斜杠、无空段、无 . / .. 段。
 */
function isSafeRelPath(p: string): boolean {
  if (p.startsWith('/') || p.includes('\\')) return false
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

// ---------------------------------------------------------------------------
// CSS 注入防线（D1：color/fontFamily 整框级外观字段将来直接套进容器 CSS）
//
// 这些值不经渲染层二次清洗即落进 style 属性，故 schema 层做字符级白名单是硬要求：
// 非裸字符串落盘 —— 只放行能合法构成 CSS 值的字符集，拒一切可越出 CSS 值上下文的字符
// （`;` 结束声明、`{` `}` 越出规则、`url(` `expression(` 加载/执行、反斜杠转义逃逸、控制字符）。
// 长度上限兜底拒绝超长 payload（DoS / 绕过尝试）。
// ---------------------------------------------------------------------------

/** color/fontFamily 字段长度上限（合法值远短于此，超长一律视为攻击） */
const STYLE_VALUE_MAX_LEN = 100

/**
 * 元素标题（图层名）name 长度上限：20 个字（按 Unicode code point 计数，
 * `Array.from(str).length`——emoji/扩展区字符算 1 个字，不用 .length 的 UTF-16 双算）。
 * 六类统一：五类可选 name 与 frame 必填 name 同限。UI 改名提交链路在 commitInline 前置同口径截断。
 */
export const NAME_MAX_LEN = 20

/** name 是否超长（code point 计数 > NAME_MAX_LEN） */
function nameTooLong(v: string): boolean {
  return Array.from(v).length > NAME_MAX_LEN
}

/** 字符串含 ASCII 控制字符或 Unicode 行/段分隔等不可见控制字符（CSS 上下文中均非法） */
function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    // C0 控制符 (0x00-0x1F)、DEL+C1 (0x7F-0x9F)、行分隔 0x2028、段分隔 0x2029
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

/**
 * color 值清洗：允许 hex / rgb() / rgba() / hsl() / hsla() / 常见关键字形态。
 * 字符集约束到 `[#a-zA-Z0-9(),.%\s-]`（含括号供函数式颜色），叠加：
 * 禁控制字符、禁 `url(` / `expression(`（即便仅 `(` 在集合内，函数名也被这两条拦死）、长度上限。
 */
function isCleanColor(v: string): boolean {
  if (v.length === 0 || v.length > STYLE_VALUE_MAX_LEN) return false
  if (hasControlChar(v)) return false
  if (!/^[#a-zA-Z0-9(),.%\s-]+$/.test(v)) return false
  const lower = v.toLowerCase()
  if (lower.includes('url(') || lower.includes('expression(')) return false
  return true
}

/**
 * fontFamily 值清洗：允许字母数字、空格、连字符、逗号、引号（字体名带空格需引号）。
 * 显式拒 `;` `}` `{` `url(` `expression(` 反斜杠、控制字符 —— 这些可越出 CSS 值上下文。
 */
function isCleanFontFamily(v: string): boolean {
  if (v.length === 0 || v.length > STYLE_VALUE_MAX_LEN) return false
  if (hasControlChar(v)) return false
  // 白名单字符集：字母数字 + 空格 + 连字符 + 逗号 + 单/双引号（不含括号、分号、花括号、反斜杠）
  if (!/^[a-zA-Z0-9 ,'"-]+$/.test(v)) return false
  const lower = v.toLowerCase()
  if (lower.includes('url(') || lower.includes('expression(')) return false
  return true
}

/**
 * 各 type 的必填字段表（在 ElementBase 之外）。字符串字段分两类：
 * - str：必须为非空字符串。用于结构性引用（id/文件名/资源路径/形状枚举），空值无意义且会断引用。
 * - strEditable：必须为字符串，允许空串。用于用户就地编辑的展示内容（文字元素正文、画框名），
 *   清空即合法（空文字 = 删字保留元素、空画框名 = 未命名画框）。
 */
const REQUIRED_FIELDS: Record<ElementType, { num: string[]; str: string[]; strEditable: string[] }> = {
  html: { num: ['x', 'y'], str: ['file'], strEditable: [] },
  shape: { num: ['x', 'y', 'w', 'h'], str: ['shape'], strEditable: [] },
  text: { num: ['x', 'y', 'fontSize'], str: [], strEditable: ['text'] },
  image: { num: ['x', 'y', 'w', 'h'], str: ['src'], strEditable: [] },
  arrow: { num: ['x1', 'y1', 'x2', 'y2'], str: [], strEditable: [] },
  frame: { num: ['x', 'y', 'w', 'h'], str: [], strEditable: ['name'] },
}

export function validateCanvasDoc(data: unknown): ValidationResult {
  const errors: string[] = []
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['canvas.json 顶层必须是对象'] }
  }
  const doc = data as Record<string, unknown>

  if (doc['format'] !== BOARD_FORMAT) {
    errors.push(`format 必须为 "${BOARD_FORMAT}"，实际为 ${JSON.stringify(doc['format'])}`)
  }
  if (!isStr(doc['title'])) {
    errors.push('title 必须为非空字符串')
  }
  if (!Array.isArray(doc['elements'])) {
    errors.push('elements 必须为数组')
    return { ok: false, errors }
  }

  const seenIds = new Set<string>()
  const elements = doc['elements'] as unknown[]
  elements.forEach((el, i) => {
    const where = (id?: unknown) =>
      `elements[${i}]${isStr(id) ? ` (id=${id})` : ''}`
    if (typeof el !== 'object' || el === null) {
      errors.push(`${where()} 必须是对象`)
      return
    }
    const e = el as Record<string, unknown>
    if (!isStr(e['id'])) {
      errors.push(`${where()} 缺少非空 id`)
    } else if (seenIds.has(e['id'])) {
      errors.push(`${where(e['id'])} id 重复`)
    } else {
      seenIds.add(e['id'])
    }

    const type = e['type']
    // Object.hasOwn 而非 in：防 type:"toString"/"__proto__" 命中原型链（评审 P1-1）
    if (!isStr(type) || !Object.hasOwn(REQUIRED_FIELDS, type)) {
      errors.push(`${where(e['id'])} type 非法：${JSON.stringify(type)}`)
      return
    }
    // 必填字段一律限自有属性（R-3，Object.hasOwn）：原型链上的同名值不算「已提供」——
    // 否则 Object.create({name:'F'}) 一类对象会带着原型脏值绕过必填校验
    const req = REQUIRED_FIELDS[type as ElementType]
    for (const f of req.num) {
      if (!Object.hasOwn(e, f) || !isNum(e[f])) errors.push(`${where(e['id'])} ${type} 缺少数值字段 ${f}`)
    }
    for (const f of req.str) {
      if (!Object.hasOwn(e, f) || !isStr(e[f])) errors.push(`${where(e['id'])} ${type} 缺少字符串字段 ${f}`)
    }
    for (const f of req.strEditable) {
      if (!Object.hasOwn(e, f) || typeof e[f] !== 'string') {
        errors.push(`${where(e['id'])} ${type} 的 ${f} 必须为字符串`)
      }
    }
    if (type === 'shape' && isStr(e['shape']) && !['diamond', 'rect'].includes(e['shape'])) {
      errors.push(`${where(e['id'])} shape 取值非法：${e['shape']}（须为 diamond|rect）`)
    }
    if (e['parent'] !== undefined && !isStr(e['parent'])) {
      errors.push(`${where(e['id'])} parent 必须为字符串`)
    }
    // 元素标题（图层名）：html/shape/text/image/arrow 的可选 name（缺省合法，给值须为字符串、允许空串）。
    // frame 的 name 是必填项，已由上方 strEditable 校验类型，不在此重复。
    // 「键是否存在」限自有属性（R-3，Object.hasOwn 防原型链字段误命中）。
    if (type !== 'frame' && Object.hasOwn(e, 'name') && e['name'] !== undefined) {
      if (typeof e['name'] !== 'string') {
        errors.push(`${where(e['id'])} ${type} 的 name 必须为字符串`)
      }
    }
    // name 长度上限（六类统一，含 frame）：≤ NAME_MAX_LEN 个字（Unicode code point 计数）
    if (Object.hasOwn(e, 'name') && typeof e['name'] === 'string' && nameTooLong(e['name'])) {
      errors.push(
        `${where(e['id'])} name 超出长度上限（≤${NAME_MAX_LEN} 字）：当前 ${Array.from(e['name']).length} 字`,
      )
    }

    // —— 各类型补充规则（评审 P1-3 路径契约 / P1-4 预留字段 / P1-5 尺寸域）——
    if (type === 'html') {
      if (isStr(e['file']) && (e['file'].includes('/') || e['file'].includes('\\') || e['file'] === '.' || e['file'] === '..')) {
        errors.push(`${where(e['id'])} file 必须是 blocks/ 下的纯文件名（不含路径分隔符）：${e['file']}`)
      }
      if (e['css'] !== undefined) {
        if (!Array.isArray(e['css']) || !e['css'].every((c) => isStr(c))) {
          errors.push(`${where(e['id'])} css 必须是非空字符串数组`)
        } else {
          for (const c of e['css'] as string[]) {
            if (!c.startsWith('styles/') || !isSafeRelPath(c)) {
              errors.push(`${where(e['id'])} css 路径必须位于 styles/ 下且不得越级：${c}`)
            }
          }
        }
      }
    }
    // measured 实测缓存：html 与 text 共用同一校验（首渲写回，{ w>0, h>0 }）
    if ((type === 'html' || type === 'text') && e['measured'] !== undefined) {
      const m = e['measured'] as Record<string, unknown> | null
      if (
        typeof m !== 'object' || m === null ||
        !isNum(m['w']) || !isNum(m['h']) || m['w'] <= 0 || m['h'] <= 0
      ) {
        errors.push(`${where(e['id'])} measured 必须是 { w>0, h>0 }`)
      }
    }
    if (type === 'image' && isStr(e['src']) && (!e['src'].startsWith('assets/') || !isSafeRelPath(e['src']))) {
      errors.push(`${where(e['id'])} src 必须位于 assets/ 下且不得越级：${e['src']}`)
    }
    if (type === 'arrow' && (e['from'] !== null || e['to'] !== null)) {
      errors.push(`${where(e['id'])} from/to 为 v1 预留字段，必须显式为 null`)
    }

    // —— text 整框级外观可选字段（D1 / Step 9；缺省合法，给值则校验/清洗）——
    // 「键是否存在」判断限自有属性（R-3，Object.hasOwn，防原型链字段误命中）
    if (type === 'text') {
      // width / lineHeight：isNum && > 0；lineHeight 额外设合理上限防排版炸裂
      if (Object.hasOwn(e, 'width') && e['width'] !== undefined) {
        if (!isNum(e['width']) || e['width'] <= 0) {
          errors.push(`${where(e['id'])} width 必须是大于 0 的数值`)
        }
      }
      if (Object.hasOwn(e, 'lineHeight') && e['lineHeight'] !== undefined) {
        if (!isNum(e['lineHeight']) || e['lineHeight'] <= 0) {
          errors.push(`${where(e['id'])} lineHeight 必须是大于 0 的数值`)
        } else if (e['lineHeight'] > 10) {
          errors.push(`${where(e['id'])} lineHeight 超出合理上限（须 ≤10）：${e['lineHeight']}`)
        }
      }
      // textAlign：枚举白名单
      if (Object.hasOwn(e, 'textAlign') && e['textAlign'] !== undefined) {
        if (e['textAlign'] !== 'left' && e['textAlign'] !== 'center' && e['textAlign'] !== 'right') {
          errors.push(`${where(e['id'])} textAlign 取值非法（须为 left|center|right）：${JSON.stringify(e['textAlign'])}`)
        }
      }
      // underline：布尔
      if (Object.hasOwn(e, 'underline') && e['underline'] !== undefined) {
        if (typeof e['underline'] !== 'boolean') {
          errors.push(`${where(e['id'])} underline 必须为布尔值`)
        }
      }
      // color：字符级白名单清洗（直接套进 CSS，防注入硬要求）
      if (Object.hasOwn(e, 'color') && e['color'] !== undefined) {
        if (typeof e['color'] !== 'string' || !isCleanColor(e['color'])) {
          errors.push(`${where(e['id'])} color 含非法字符或形态（防 CSS 注入清洗未通过）：${JSON.stringify(e['color'])}`)
        }
      }
      // fontFamily：字符级白名单清洗（直接套进 CSS，防注入硬要求）
      if (Object.hasOwn(e, 'fontFamily') && e['fontFamily'] !== undefined) {
        if (typeof e['fontFamily'] !== 'string' || !isCleanFontFamily(e['fontFamily'])) {
          errors.push(`${where(e['id'])} fontFamily 含非法字符（防 CSS 注入清洗未通过）：${JSON.stringify(e['fontFamily'])}`)
        }
      }
    }
    // 尺寸域：w/h/fontSize 必须为正（坐标允许任意有限数；arrow 两端点允许重合）
    for (const f of ['w', 'h', 'fontSize'] as const) {
      if (REQUIRED_FIELDS[type as ElementType].num.includes(f) && isNum(e[f]) && e[f] <= 0) {
        errors.push(`${where(e['id'])} ${f} 必须大于 0`)
      }
    }
  })

  // parent 引用存在性 + 指向必须是 frame（v1 不嵌套：frame 自身不得有 parent）
  const frames = new Map<string, number>() // id → 数组下标（图层序校验用）
  elements.forEach((el, i) => {
    const e = el as Record<string, unknown>
    if (e && e['type'] === 'frame' && isStr(e['id'])) frames.set(e['id'], i)
  })
  elements.forEach((el, i) => {
    const e = el as Record<string, unknown>
    if (!e || !isStr(e['parent'])) return
    if (!frames.has(e['parent'])) {
      errors.push(`elements[${i}] parent="${e['parent']}" 不存在或不是 frame`)
    } else if (frames.get(e['parent'])! > i) {
      // 图层序约束（数组序 = 图层序，DOM 序渲染）：frame 排在子元素之后会盖住子元素
      errors.push(
        `elements[${i}] parent="${e['parent']}" 对应 frame 位于其后（index ${frames.get(e['parent'])}）` +
          `——frame 必须排在其全部子元素之前（图层序约束）`,
      )
    }
    if (e['type'] === 'frame') {
      errors.push(`elements[${i}] frame 不得嵌套（v1 约束）`)
    }
  })

  return { ok: errors.length === 0, errors }
}

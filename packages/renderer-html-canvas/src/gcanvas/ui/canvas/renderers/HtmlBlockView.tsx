/**
 * HtmlBlockView —— HTML 块渲染器（mount-once 契约，设计 §2.2 渲染纪律）
 *
 * 核心纪律：Shadow DOM 内容一次注入、永不因 React 重渲而重建；React 重渲只动外层
 * left/top。块文件来自任意外部导入，注入前过 sanitize → unwrap 管线（引擎纯函数）。
 *
 * 三态：挂载前/加载中占位（有 measured 用之，无则 360×240）；加载失败 → 占位框内
 * 可读错误（文件名 + 原因），不毁整画布；成功 → Shadow DOM 真 HTML 渲染。
 *
 * sanitize/unwrap 管线照常剥离脚本/事件/危险标签/危险 css（安全防线不变），但不向用户
 * 展示"剥了啥"——剥离详情对用户无价值，不做提示。
 */
import { memo, useEffect, useRef, useState } from 'react'
import type { HtmlElement, MeasuredSize } from '../../../engine/schema'
import { useCanvasContext } from '../canvas-context'
// 引擎管线：sanitize → unwrap 顺序固定；
// 共享 css 注入前同样过 sanitizeCss（与块内样式同一套清洗）+ prepareSharedCss（翻译/重写）
import { sanitizeCss, sanitizeHtml } from '../../../engine/sanitize'
import { prepareSharedCss, unwrapBlock } from '../../../engine/unwrap'

/** 块加载占位默认尺寸（设计 §7 裁定 6，可调） */
const PLACEHOLDER_W = 360
const PLACEHOLDER_H = 240

/**
 * :host reset（继承穿透兜底，设计 §2.2 原文契约）
 * user-select:none —— 块是画布上的图形操作对象，单击选块、拖动移块，块内文字不参与原生选字
 * （否则拖拽会框选块内满屏文字）。`all:initial` 会把从画布层继承来的 user-select 重置回 auto，
 * 故须在 :host 重置里显式补回；就地编辑经双击走 text-patch 通道，不依赖原生选区。
 */
const HOST_RESET = `:host { all: initial; display: block; font-family: system-ui, -apple-system, sans-serif;
        color: #1f2329; font-size: 14px; line-height: 1.5; user-select: none; -webkit-user-select: none; }`

/** 加载态：挂载前/加载中（loading）、成功（ready）、失败（error） */
type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

/**
 * 量 host 当前布局尺寸并写回 measured（首测与 ResizeObserver 补测共用，便于直接单测决策分支）。
 *
 * 两道护栏，缺一不可：
 * - cancelled()：effect 已卸载/重跑（abort guard）→ 不再回写，防卸载后异步回调写脏已替换的 store。
 * - 0×0 跳过：隐藏标签 display:none 或布局未沉降时 offsetWidth/Height=0，写回会污染 canvas.json。
 *   （非 active 标签的写回还另有 setMeasured 内的 shouldWriteMeasured 门控兜底，二者叠加。）
 * 同尺寸由 store.setMeasured 内部 no-op，重复补测无谓落盘已被上游消解。
 */
export function measureHost(
  host: HTMLElement,
  elId: string,
  setMeasured: (id: string, size: MeasuredSize) => void,
  cancelled: () => boolean,
): void {
  if (cancelled()) return
  const w = host.offsetWidth
  const h = host.offsetHeight
  if (w > 0 && h > 0) setMeasured(elId, { w, h })
}

function HtmlBlockViewImpl({ el }: { el: HtmlElement }) {
  const { adapter, boardId, setMeasured, resourceEpoch, blockCache, blockResourceReady } = useCanvasContext()
  const hostRef = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })

  // —— mount-once 注入：仅依赖 file/css/boardId 变化重跑（热同步 sprint 启用重注入路径）——
  // css 数组以稳定字符串参与依赖，避免每渲染新数组引用导致误判变更
  const cssKey = (el.css ?? []).join('\u0000')
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const resourceKey = { boardId, hostElementId: el.id, file: el.file }
    const generation = resourceEpoch
    // StrictMode 双跑幂等：已挂 shadowRoot 则复用，不重复 attachShadow
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })

    // abort guard：卸载/重跑即取消，异步回写一律先查 cancelled。
    // teardown 收集本次注入装的 shadow 监听摘除函数，供 effect 同步 cleanup 调用
    // （async IIFE 的返回值 effect 接不到，必须经 ref 旁路交给 cleanup）。
    let cancelled = false
    let teardown: (() => void) | null = null
    setLoad({ status: 'loading' })

    void (async () => {
      try {
        // 取块文件 + css 数组逐个取（叠加序：canvas.json css 在前，块内样式压轴）
        const cssPaths = el.css ?? []
        const [rawHtml, cssTexts] = await Promise.all([
          adapter.loadBlock(boardId, el.file),
          Promise.all(cssPaths.map((p) => adapter.loadStyle(boardId, p))),
        ])
        if (cancelled) return

        // 块内容缓存对账（撤销快照前移地基）：在不可逆变换（sanitize→unwrap）**之前**登记磁盘原文字节。
        // loadBlock 是磁盘真相权威刷新口——块注入/重注入、外部 block-changed、mark/strip 后重注入都经此，
        // 缓存随之对齐为当前磁盘字节（编辑进行中为带号 raw），供 session commit 同步段推演逐字节快照。
        blockCache?.note(el.file, rawHtml)

        // 管线：sanitize（剥脚本/事件/危险标签）→ unwrap（拆壳 + 替身 body + 选择器翻译）
        const sanitized = sanitizeHtml(rawHtml)
        const cssOpts = { assetUrl: (rel: string) => adapter.assetUrl(boardId, rel) }
        const unwrapped = unwrapBlock(sanitized.html, cssOpts)

        // 共享 css 双道处理（Codex 代码评审 P0-2：不得走免检通道）：
        // ① sanitizeCss——与块内样式同一套清洗（@import/外网 url()），剥离危险声明（结果不展示给用户）；
        // ② prepareSharedCss——选择器翻译 + assets url 重写（:root/body 原样注入 shadow 永不命中）
        const sharedCss = cssTexts.map((css, i) => {
          const cleaned = sanitizeCss(css, `共享样式 ${cssPaths[i]}`)
          return prepareSharedCss(cleaned.css, cssOpts)
        })

        // 组装 shadow 内容：替身 body 片段先 innerHTML，样式以 DOM 节点 + textContent
        // 前插（:host reset → 共享 css 按序 → 块内样式压轴）。css 一律不拼 innerHTML——
        // 文件直读的 css 若含 "</style>" 字面量会逃出标签注入任意标记（评审 P0-2）
        shadow.innerHTML = unwrapped.bodyHtml
        const styleFrag = document.createDocumentFragment()
        for (const cssText of [HOST_RESET, ...sharedCss, ...unwrapped.styles]) {
          const styleEl = document.createElement('style')
          styleEl.textContent = cssText
          styleFrag.appendChild(styleEl)
        }
        shadow.insertBefore(styleFrag, shadow.firstChild)

        // shadowRoot 内原生 capture 监听（防误导航，设计 §2.2）：
        // submit 不跨 shadow 边界、React 合成事件会 retarget——必须装在仓内，Stage 门口拦不到
        const onClickCapture = (ev: Event) => {
          const path = ev.composedPath()
          for (const node of path) {
            // 按标签名判 <a>：SVG 的 <a> 是 SVGAElement 而非 HTMLAnchorElement，
            // 仅 instanceof HTMLAnchorElement 会放走 SVG 链接（Codex 代码评审 P0-1 随附核实）
            if (node instanceof Element && node.localName === 'a') {
              ev.preventDefault()
              return
            }
          }
        }
        const onSubmitCapture = (ev: Event) => ev.preventDefault()
        shadow.addEventListener('click', onClickCapture, true)
        shadow.addEventListener('submit', onSubmitCapture, true)

        // 实测尺寸 → store.setMeasured（旁路；同尺寸 no-op 由 store 内部处理）。
        // 首测紧跟 innerHTML，此刻字体/图片/布局未必沉降（agent 写盘块天生无 measured，首测常偏小或为 0）。
        // 故除首测外再挂 ResizeObserver：内容沉降（web 字体替换、图片解码、回流）引起尺寸变化时补测到稳态，
        // 把真实渲染盒写回 measured——否则选中框退回 360×240 占位、贴不住真实盒。
        measureHost(host, el.id, setMeasured, () => cancelled)

        // ResizeObserver 在无布局引擎的环境（jsdom 单测）缺失——特性探测后再挂，缺失则仅靠首测兜底。
        let ro: ResizeObserver | null = null
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => measureHost(host, el.id, setMeasured, () => cancelled))
          ro.observe(host)
        }

        teardown = () => {
          shadow.removeEventListener('click', onClickCapture, true)
          shadow.removeEventListener('submit', onSubmitCapture, true)
          ro?.disconnect()
        }

        setLoad({ status: 'ready' })
        blockResourceReady?.publishReady(resourceKey, generation)
      } catch (err) {
        if (cancelled) return
        // 加载失败 → 占位框内可读错误，不毁整画布
        setLoad({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
        blockResourceReady?.publishError(resourceKey, generation, err)
      }
    })()

    return () => {
      cancelled = true
      teardown?.()
      blockResourceReady?.publishUnmounted(resourceKey, generation)
    }
    // resourceEpoch 入依赖：外部 block/style/asset 变更时全量重注入（设计 §2.6；
    // shadow host 经 attachShadow 幂等复用、仅重设内容，mount-once 契约不破）
  }, [adapter, boardId, el.id, el.file, cssKey, setMeasured, resourceEpoch, blockCache, blockResourceReady])

  // 占位/错误态尺寸：有 measured 用之，否则默认占位
  const w = el.measured?.w ?? PLACEHOLDER_W
  const h = el.measured?.h ?? PLACEHOLDER_H

  // host 是 Shadow DOM 宿主。占位/错误卡必须是 host 的**兄弟节点**：
  // host 一挂 shadowRoot，其 light DOM 子节点没有 <slot> 就不渲染——放 host 里面
  // 真浏览器看不见（Codex 代码评审 P1-3；jsdom 无此行为故单测曾假阳性）。
  // 加载中/失败时 host 的 shadow 为空（零尺寸），兄弟占位卡自然落在 wrapper 原位。
  return (
    <>
      <div ref={hostRef} className="hc-html-host" />
      {load.status === 'loading' && (
        <div className="hc-html-placeholder" style={{ width: w, height: h }}>
          <span className="hc-html-placeholder-text">加载块 {el.file}…</span>
        </div>
      )}
      {load.status === 'error' && (
        <div className="hc-html-placeholder is-error" style={{ width: w, height: h }}>
          <span className="hc-html-placeholder-title">块加载失败</span>
          <span className="hc-html-placeholder-file">{el.file}</span>
          <span className="hc-html-placeholder-reason">{load.message}</span>
        </div>
      )}
    </>
  )
}

/**
 * React.memo 自定义比较：仅 x/y/css/file/measured 变化才重渲；其余引用变化跳过。
 * file/css 变化 = 重注入（mount-once effect 依赖 file/cssKey，热同步 sprint 走此路径）。
 * x/y 变化只动外层 left/top（由 ElementLayer 的 wrapper 承接，此处比较仅为跳过无关重渲）。
 */
export const HtmlBlockView = memo(HtmlBlockViewImpl, (prev, next) => {
  const a = prev.el
  const b = next.el
  return (
    a.id === b.id &&
    a.x === b.x &&
    a.y === b.y &&
    a.file === b.file &&
    (a.css ?? []).join('\u0000') === (b.css ?? []).join('\u0000') &&
    a.measured?.w === b.measured?.w &&
    a.measured?.h === b.measured?.h
  )
})

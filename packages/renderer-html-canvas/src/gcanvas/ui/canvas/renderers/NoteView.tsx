/**
 * NoteView —— 标注卡片静态渲染
 *
 * 卡片 = 三色底 + 正文（Markdown，编辑内核 full 档静态渲染，与编辑态同一解析路径）。
 * 正文来自 notes/ 文件，经 NoteContentCache 订阅：显示的是 display（含已提交未落盘的乐观值），
 * 所以退出编辑后立刻是新正文。加载中 / 文件缺失 / 读取失败各有占位；空正文不显示任何提示。
 * 显示尺寸（宽 w、内容自然高）在非加载态量出后经 ctx.setMeasured 写回，供剔除与包围盒使用。
 * 卡片里的链接：普通单击不跳转；⌘ / Ctrl 单击在新窗口打开（规则见 editor-kernel/link-open.ts）。
 * 判断与打开都在卡片自己的点击处理里完成，点击直接落到卡片上的只读查看器原样可用；
 * 画布里普通单击由画布选中（click 被指针捕获带走，到不了链接），⌘ 按下时画布让路，click 落到链接上。
 * 定位 wrapper 由 ElementLayer 统一加。
 */
import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { NoteSnapshot } from '../../../engine/note-content-cache'
import type { NoteElement } from '../../../engine/schema'
import { NOTE_DEFAULT_COLOR, noteFontSize } from '../../../engine/note-model'
import { renderStaticMarkdown } from '../../editor-kernel'
import { isOpenLinkGesture, openableLinkHref, openLinkInNewWindow } from '../../editor-kernel/link-open'
import { useCanvasContext } from '../canvas-context'

/** 卡片字号变量（正文随它等比缩放，见 content.css 的 --hc-note-font-size） */
export function noteSizeStyle(el: Pick<NoteElement, 'sizeTier'>): CSSProperties {
  return { '--hc-note-font-size': `${noteFontSize(el)}px` } as CSSProperties
}

const LOADING: NoteSnapshot = { entry: { state: 'loading' }, display: null, stale: false }

function sameSnapshot(a: NoteSnapshot, b: NoteSnapshot): boolean {
  return a.display === b.display && a.stale === b.stale && a.entry === b.entry
}

/**
 * 订阅某份标注正文的当前状态；挂载时触发加载。
 * 上下文里没有加载器（轻量渲染单测）→ 恒为加载态。
 */
export function useNoteContent(file: string): NoteSnapshot {
  const { noteContent } = useCanvasContext()
  const cache = noteContent?.cache
  const loader = noteContent?.loader
  // getSnapshot 须返回稳定引用：peek 每次新建对象，按字段比较后复用上一份
  const last = useRef<NoteSnapshot>(LOADING)
  const snap = useSyncExternalStore(
    (cb) => (cache ? cache.subscribe((f) => f === file && cb()) : () => {}),
    () => {
      const next = cache?.peek(file) ?? LOADING
      if (!sameSnapshot(last.current, next)) last.current = next
      return last.current
    },
  )
  useEffect(() => {
    loader?.ensure(file)
  }, [loader, file])
  return snap
}

export function NoteView({ el }: { el: NoteElement }) {
  const { setMeasured } = useCanvasContext()
  const ref = useRef<HTMLDivElement>(null)
  const snap = useNoteContent(el.file)
  const color = el.color ?? NOTE_DEFAULT_COLOR

  // 有正文（含待定值）即 ready；否则按确认值状态
  const state = snap.display !== null ? 'ready' : snap.entry.state === 'ready' ? 'ready' : snap.entry.state
  const html = useMemo(
    // {__html} 包装对象须 memo：react-dom 按对象引用比较，每渲染新建会重设 innerHTML（双击合成失灵）
    () => (snap.display !== null ? { __html: renderStaticMarkdown('full', snap.display) } : null),
    [snap.display],
  )

  // 排版尺寸不受画布缩放影响；jsdom 量出 0 不写
  useLayoutEffect(() => {
    if (state === 'loading') return
    const node = ref.current
    if (!node) return
    const w = node.offsetWidth
    const h = node.offsetHeight
    if (w > 0 && h > 0) setMeasured(el.id, { w, h })
  }, [html, el.w, el.h, color, el.sizeTier, state, el.id, setMeasured])

  return (
    <div
      ref={ref}
      className={`hc-note hc-note--${color}`}
      data-hc-note-file={el.file}
      style={{ width: el.w, minHeight: el.h, ...noteSizeStyle(el) }}
      onAuxClickCapture={(e) => {
        // 中键 / 右键点链接：浏览器默认会在新标签打开，绕过「⌘ 才打开」
        if ((e.target as Element).closest('a')) e.preventDefault()
      }}
      onClickCapture={(e) => {
        if (!(e.target as Element).closest('a')) return
        // 链接从不按浏览器默认方式跳转（默认会当场开窗口，普通单击也开）
        e.preventDefault()
        if (!isOpenLinkGesture(e)) return
        const href = openableLinkHref(e.target)
        if (href) openLinkInNewWindow(href)
      }}
    >
      {state === 'ready' && html && (
        // 内容已经 sanitizeHtml（renderStaticMarkdown 内）清洗
        <div className="hc-note-body prose prose-sm hc-prose" dangerouslySetInnerHTML={html} />
      )}
      {state === 'loading' && <div className="hc-note-body hc-note-placeholder" aria-busy="true" />}
      {state === 'missing' && <div className="hc-note-body hc-note-problem">找不到标注文件 {el.file}</div>}
      {state === 'error' && <div className="hc-note-body hc-note-problem">标注文件读取失败</div>}
    </div>
  )
}

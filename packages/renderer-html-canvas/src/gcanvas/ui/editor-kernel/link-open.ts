/**
 * 编辑内核 —— 富文本里的链接怎么打开（标注卡片静态显示；full 档编辑器即标注与文档面板编辑中）
 *
 * 规则：单击只做选中 / 放光标；按住 ⌘（Windows / Linux 为 Ctrl）单击才打开。打开 = 新窗口、不带来源页
 * （`noopener,noreferrer`）：浏览器里是新标签页，桌面应用把新窗口请求交给系统浏览器（electron/window.ts）。
 *
 * 只打开写全了的 http / https 网址，与桌面应用放行外链的口径一致（protocol-core 的 classifyNavigationTarget）。
 * 其余一律当作不可打开：mailto / tel 桌面应用本就不放行；相对路径与 `#锚点` 会解析到应用自己的页面；
 * 渲染时被清成空地址的链接（原为 javascript: 等）同理。不可打开的链接按普通文字对待——单击照常选中。
 *
 * - `openableLinkHref`：从点击目标往上找链接，返回可打开的地址或 null（卡片、画布、编辑器三处共用）。
 * - `openLinkInNewWindow`：打开。
 * - `LinkOpenOnModifierClick`：编辑中的 ⌘ 单击打开（full 档装配，配合 Link 扩展 `openOnClick: false`，见 extensions.ts）。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/** 这次点击是否按着「打开链接」的修饰键（⌘ / Ctrl） */
export function isOpenLinkGesture(ev: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return ev.metaKey || ev.ctrlKey
}

/**
 * 点击目标所在链接的可打开地址：目标自身或祖先里最近的 `a[href]`，地址须是写全了的 http / https 网址。
 * 给了 `within` 时，链接须在它之内（编辑器只认自己正文里的链接）。
 */
export function openableLinkHref(target: EventTarget | null, within?: Node): string | null {
  if (!target || typeof (target as Element).closest !== 'function') return null
  const a = (target as Element).closest('a[href]')
  if (!a || (within && !within.contains(a))) return null
  let url: URL
  try {
    url = new URL(a.getAttribute('href') ?? '')
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}

/** 在新窗口打开（不带来源页、新页拿不到本页） */
export function openLinkInNewWindow(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer')
}

/** 编辑中：⌘ / Ctrl 单击正文里的可打开链接 → 打开；其余单击不接管，交 ProseMirror 放光标 */
export const LinkOpenOnModifierClick = Extension.create({
  name: 'linkOpenOnModifierClick',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkOpenOnModifierClick'),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || !isOpenLinkGesture(event)) return false
            const href = openableLinkHref(event.target, view.dom)
            if (!href) return false
            openLinkInNewWindow(href)
            return true
          },
        },
      }),
    ]
  },
})

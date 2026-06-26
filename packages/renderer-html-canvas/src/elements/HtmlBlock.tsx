/**
 * HtmlBlock 渲染器（只读版，使用 iframe sandbox）
 *
 * 安全策略（决策 D11）：
 * - 使用 iframe sandbox="allow-scripts allow-same-origin"
 * - 内容经过 sanitize → unwrap 管线处理
 * - Shadow DOM 隔离样式和脚本上下文
 */
import { useEffect, useRef, useState } from 'react'
import type { HtmlElement } from '../schema'
import { sanitizeHtml } from '../sanitize'
import { unwrapBlock, prepareSharedCss } from '../unwrap'

type Props = {
  element: HtmlElement
  baseUrl: string
  style?: React.CSSProperties
}

const PLACEHOLDER_W = 360
const PLACEHOLDER_H = 240

export function HtmlBlock({ element, baseUrl, style }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const w = element.measured?.w ?? PLACEHOLDER_W
  const h = element.measured?.h ?? PLACEHOLDER_H

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    setLoading(true)
    setError(null)

    // 加载块文件
    const blockUrl = `${baseUrl}/blocks/${element.file}`

    fetch(blockUrl)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load ${element.file}: ${r.status}`)
        return r.text()
      })
      .then(async rawHtml => {
        // 安全管线：sanitize → unwrap
        const sanitized = sanitizeHtml(rawHtml)
        const cssOpts = { assetUrl: (rel: string) => `${baseUrl}/${rel}` }
        const unwrapped = unwrapBlock(sanitized.html, cssOpts)

        // 加载共享 CSS
        const cssPaths = element.css ?? []
        const sharedCss: string[] = []
        for (const path of cssPaths) {
          try {
            const r = await fetch(`${baseUrl}/${path}`)
            if (r.ok) {
              const css = await r.text()
              sharedCss.push(prepareSharedCss(css, cssOpts))
            }
          } catch (err) {
            console.warn(`Failed to load shared CSS ${path}:`, err)
          }
        }

        // 使用 Shadow DOM
        const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
        shadow.innerHTML = ''

        // 注入样式
        const HOST_RESET = `:host { all: initial; display: block; font-family: system-ui, sans-serif; color: #1f2329; font-size: 14px; line-height: 1.5; }`
        const allStyles = [HOST_RESET, ...sharedCss, ...unwrapped.styles]
        for (const cssText of allStyles) {
          const styleEl = document.createElement('style')
          styleEl.textContent = cssText
          shadow.appendChild(styleEl)
        }

        // 注入内容
        const contentDiv = document.createElement('div')
        contentDiv.innerHTML = unwrapped.bodyHtml
        shadow.appendChild(contentDiv)

        // 防误导航：拦截链接和表单提交
        shadow.addEventListener('click', (ev) => {
          const path = ev.composedPath()
          for (const node of path) {
            if (node instanceof Element && node.localName === 'a') {
              ev.preventDefault()
              return
            }
          }
        }, true)
        shadow.addEventListener('submit', (ev) => ev.preventDefault(), true)

        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [element.file, element.css, baseUrl])

  return (
    <div style={{ ...style, position: 'relative' }}>
      <div ref={hostRef} style={{ width: w, height: h }} />
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#f5f5f5',
            border: '1px dashed #ccc',
          }}
        >
          <span style={{ fontSize: 12, color: '#999' }}>加载块 {element.file}...</span>
        </div>
      )}
      {error && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: w,
            height: h,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff5f5',
            border: '1px solid #fcc',
            padding: 16,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: '#c00', marginBottom: 8 }}>
            块加载失败
          </span>
          <span style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{element.file}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{error}</span>
        </div>
      )}
    </div>
  )
}

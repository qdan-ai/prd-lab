#!/usr/bin/env node
/**
 * extract —— 在页面里导出每个画板元素的世界坐标几何与关键渲染属性，并截图。
 *
 * 用法：
 *   node extract.mjs --url <页面地址> --out <json路径> [--shots <截图目录>] [--expect <元素数>]
 *   node extract.mjs --gcanvas <画板目录> --out <json路径> [--shots <截图目录>] [--save-canvas <路径>]
 *
 * --url        已在运行的页面（PRD-Lab 查看器或 G-canvas）。
 * --gcanvas    画板目录：复制到临时目录，用上游自己的 tsx 起上游开发态，打开后导出，结束时停掉自己起的进程。
 *              上游会把 measured 写回临时副本；--save-canvas 把写回后的 canvas.json 存出来。
 * --expect     预期元素数（缺省：--gcanvas 模式取 canvas.json 元素数，--url 模式不校验）。
 * --viewport   浏览器视口，缺省 1800x1100。
 * --gcanvas-repo  上游仓库根目录（缺省读环境变量 GCANVAS_REPO，再缺省与 prd-lab 同级的 ../html_canvas）。
 *
 * 约定的 DOM：舞台 .hc-stage，世界容器 .hc-world（transform = translate(tx,ty) scale(zoom)），
 * 元素 [data-hc-id][data-hc-type]；箭头 .hc-arrow；文本 .hc-text；HTML 块 .hc-html-host（Shadow DOM）。
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i++
    }
  }
  return args
}

/** 页内执行：采集一次完整快照（世界坐标）。 */
function pageSnapshot() {
  const stage = [...document.querySelectorAll('.hc-stage')].find((s) => s.getBoundingClientRect().width > 0)
  const world = stage?.querySelector('.hc-world')
  if (!stage || !world) return null

  // 探针：放在世界原点的 100x100 方块，量出世界原点的屏幕位置与缩放，不依赖 transform-origin 假设
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:100px;pointer-events:none;visibility:hidden'
  world.appendChild(probe)
  const pr = probe.getBoundingClientRect()
  probe.remove()
  const zoom = pr.width / 100
  const ox = pr.left
  const oy = pr.top
  const r2 = (n) => Math.round(n * 100) / 100
  const toWorldRect = (rect) => ({
    x: r2((rect.left - ox) / zoom),
    y: r2((rect.top - oy) / zoom),
    w: r2(rect.width / zoom),
    h: r2(rect.height / zoom),
  })
  const toWorldPt = (x, y) => ({ x: r2((x - ox) / zoom), y: r2((y - oy) / zoom) })
  const basename = (u) => {
    try {
      return decodeURIComponent(new URL(u, location.href).pathname.split('/').pop() ?? '')
    } catch {
      return String(u).split('?')[0].split('/').pop()
    }
  }

  // 路径 d 加上 SVG 盒的世界原点（仅处理绝对命令 M/L/C/Q）
  const worldPath = (d, originX, originY) => {
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
    const out = []
    let cmd = ''
    let idx = 0
    for (const t of tokens) {
      if (/^[a-zA-Z]$/.test(t)) {
        cmd = t
        idx = 0
        out.push(t)
        continue
      }
      const n = parseFloat(t)
      const base = idx % 2 === 0 ? originX : originY
      out.push(String(r2(/[MLCQ]/.test(cmd) ? n + base : n)))
      idx++
    }
    return out.join(' ')
  }

  const markerInfo = (svg, ref) => {
    if (!ref || ref === 'none') return null
    const m = /url\(["']?#([^"')]+)["']?\)/.exec(ref)
    const marker = m ? svg.ownerDocument.getElementById(m[1]) : null
    if (!marker) return { missing: true }
    const shape = marker.querySelector('path, polygon, polyline')
    const cs = shape ? getComputedStyle(shape) : null
    return {
      d: shape?.getAttribute('d') ?? shape?.getAttribute('points') ?? '',
      fill: cs ? cs.fill : '',
      stroke: cs ? cs.stroke : '',
      refX: marker.getAttribute('refX'),
      refY: marker.getAttribute('refY'),
      markerWidth: marker.getAttribute('markerWidth'),
      markerHeight: marker.getAttribute('markerHeight'),
      orient: marker.getAttribute('orient'),
    }
  }

  // Markdown 行内/块级标签的关键计算样式（每种标签取首个）
  const inlineStyles = (root) => {
    const out = {}
    for (const tag of ['strong', 'em', 's', 'mark', 'code', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'p', 'blockquote']) {
      const n = root.querySelector(tag)
      if (!n) continue
      const c = getComputedStyle(n)
      out[tag] = {
        fontWeight: c.fontWeight,
        fontStyle: c.fontStyle,
        textDecorationLine: c.textDecorationLine,
        backgroundColor: c.backgroundColor,
        color: c.color,
        listStyleType: c.listStyleType,
        marginTop: c.marginTop,
        marginBottom: c.marginBottom,
        paddingLeft: c.paddingLeft,
      }
    }
    return out
  }

  const elements = {}
  const order = []
  for (const node of world.querySelectorAll('[data-hc-id]')) {
    const id = node.getAttribute('data-hc-id')
    if (elements[id]) continue
    const type = node.getAttribute('data-hc-type')
    const rect = node.getBoundingClientRect()
    const rec = { id, type, hidden: rect.width === 0 && rect.height === 0, box: toWorldRect(rect) }
    order.push(id)

    if (type === 'arrow') {
      const svg = node.querySelector('svg')
      const svgRect = svg.getBoundingClientRect()
      const o = toWorldPt(svgRect.left, svgRect.top)
      const visible = [...svg.querySelectorAll(':scope > path')].filter((p) => {
        const s = p.getAttribute('stroke')
        return s !== 'transparent' && getComputedStyle(p).stroke !== 'rgba(0, 0, 0, 0)'
      })
      const path = visible[visible.length - 1]
      const cs = path ? getComputedStyle(path) : null
      const label = node.querySelector('.hc-arrow-label')
      const labelRect = label?.getBoundingClientRect()
      rec.arrow = {
        pathCount: visible.length,
        d: path ? worldPath(path.getAttribute('d') ?? '', o.x, o.y) : '',
        stroke: cs?.stroke ?? '',
        strokeWidth: cs ? parseFloat(cs.strokeWidth) : null,
        dasharray: cs?.strokeDasharray ?? '',
        linecap: cs?.strokeLinecap ?? '',
        markerStart: path ? markerInfo(svg, path.getAttribute('marker-start') ?? cs?.markerStart) : null,
        markerEnd: path ? markerInfo(svg, path.getAttribute('marker-end') ?? cs?.markerEnd) : null,
        label: label
          ? {
              text: (label.textContent ?? '').trim(),
              center: toWorldPt(labelRect.left + labelRect.width / 2, labelRect.top + labelRect.height / 2),
            }
          : null,
      }
    } else if (type === 'text') {
      const t = node.querySelector('.hc-text') ?? node
      const cs = getComputedStyle(t)
      rec.text = {
        html: t.innerHTML,
        fontSize: parseFloat(cs.fontSize),
        fontFamily: cs.fontFamily,
        color: cs.color,
        width: r2(t.getBoundingClientRect().width / zoom),
        textAlign: cs.textAlign,
        lineHeight: cs.lineHeight,
        textDecorationLine: cs.textDecorationLine,
        whiteSpace: cs.whiteSpace,
        box: toWorldRect(t.getBoundingClientRect()),
        inline: inlineStyles(t),
      }
    } else if (type === 'frame') {
      const title = node.querySelector('.hc-frame-title')
      rec.frame = { title: (title?.textContent ?? '').trim() }
    } else if (type === 'shape') {
      const shape = node.querySelector('.hc-shape') ?? node.firstElementChild
      const cs = shape ? getComputedStyle(shape) : null
      rec.shape = {
        className: shape?.className ?? '',
        text: (node.querySelector('.hc-shape-text')?.textContent ?? '').trim(),
        clipPath: cs?.clipPath ?? '',
        background: cs?.backgroundColor ?? '',
        borderTopWidth: cs ? parseFloat(cs.borderTopWidth) : null,
        borderTopColor: cs?.borderTopColor ?? '',
      }
    } else if (type === 'image') {
      const img = node.querySelector('img')
      const ir = img?.getBoundingClientRect()
      rec.image = {
        file: img ? basename(img.getAttribute('src') ?? '') : '',
        complete: !!img?.complete && (img?.naturalWidth ?? 0) > 0,
        natural: { w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 },
        size: ir ? { w: r2(ir.width / zoom), h: r2(ir.height / zoom) } : null,
      }
    } else if (type === 'html') {
      const host = node.querySelector('.hc-html-host')
      const root = host?.shadowRoot
      const hr = host?.getBoundingClientRect()
      const imgs = root ? [...root.querySelectorAll('img')] : []
      rec.html = {
        hostBox: hr ? toWorldRect(hr) : null,
        hasShadow: !!root,
        elemCount: root ? root.querySelectorAll('*').length : 0,
        text: root ? (root.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) : '',
        imgs: imgs.map((i) => ({
          file: basename(i.getAttribute('src') ?? ''),
          complete: i.complete && i.naturalWidth > 0,
          size: { w: r2(i.getBoundingClientRect().width / zoom), h: r2(i.getBoundingClientRect().height / zoom) },
        })),
      }
    }
    elements[id] = rec
  }

  const sr = stage.getBoundingClientRect()
  return {
    camera: { zoom: Math.round(zoom * 1000) / 1000, tx: r2(ox - sr.left), ty: r2(oy - sr.top), stage: { w: r2(sr.width), h: r2(sr.height) } },
    order,
    elements,
  }
}

/** 轮询到快照连续稳定且 HTML 块 / 图片都就绪。 */
async function waitStable(page, expect, timeoutMs = 45000) {
  const start = Date.now()
  let last = ''
  let same = 0
  while (Date.now() - start < timeoutMs) {
    const snap = await page.evaluate(pageSnapshot)
    if (snap) {
      const els = Object.values(snap.elements)
      const ready =
        (expect == null || els.length === expect) &&
        els.every((e) => {
          if (e.type === 'html') return e.html.hasShadow && e.html.elemCount > 0 && e.html.imgs.every((i) => i.complete)
          if (e.type === 'image') return e.image.complete
          return true
        })
      const key = JSON.stringify(snap)
      if (ready && key === last) same++
      else same = 0
      last = key
      if (ready && same >= 4) return snap
    }
    await page.waitForTimeout(350)
  }
  const snap = await page.evaluate(pageSnapshot)
  throw new Error(
    `等待稳定超时（${timeoutMs}ms）：元素数 ${snap ? Object.keys(snap.elements).length : '无舞台'}，预期 ${expect ?? '未指定'}`,
  )
}

/** 截图：整板一张 + 每元素一张（把世界容器临时调成"元素居中、整体放得下"的相机再裁切）。 */
async function takeShots(page, snap, shotsDir) {
  mkdirSync(shotsDir, { recursive: true })
  const stageBox = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.hc-stage')].find((x) => x.getBoundingClientRect().width > 0)
    const r = s.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  })
  await page.screenshot({ path: path.join(shotsDir, 'board.png'), clip: { x: stageBox.x, y: stageBox.y, width: stageBox.w, height: stageBox.h } })

  const original = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.hc-stage')].find((x) => x.getBoundingClientRect().width > 0)
    return s.querySelector('.hc-world').style.transform
  })
  const pad = 24
  for (const id of snap.order) {
    const el = snap.elements[id]
    if (el.hidden) continue
    // 目标：缩放 min(1, 放得下)，元素居中
    const zoom = Math.min(1, (stageBox.w - pad * 2) / el.box.w, (stageBox.h - pad * 2) / el.box.h)
    const tx = stageBox.w / 2 - (el.box.x + el.box.w / 2) * zoom
    const ty = stageBox.h / 2 - (el.box.y + el.box.h / 2) * zoom
    await page.evaluate(
      ({ tx, ty, zoom }) => {
        const s = [...document.querySelectorAll('.hc-stage')].find((x) => x.getBoundingClientRect().width > 0)
        s.querySelector('.hc-world').style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`
      },
      { tx, ty, zoom },
    )
    await page.waitForTimeout(250)
    const w = Math.min(stageBox.w, el.box.w * zoom + pad * 2)
    const h = Math.min(stageBox.h, el.box.h * zoom + pad * 2)
    await page.screenshot({
      path: path.join(shotsDir, `el-${id}.png`),
      clip: {
        x: stageBox.x + stageBox.w / 2 - w / 2,
        y: stageBox.y + stageBox.h / 2 - h / 2,
        width: w,
        height: h,
      },
    })
  }
  await page.evaluate((t) => {
    const s = [...document.querySelectorAll('.hc-stage')].find((x) => x.getBoundingClientRect().width > 0)
    s.querySelector('.hc-world').style.transform = t
  }, original)
}

async function startGcanvas(boardDir, viewerDir) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'parity-gcanvas-'))
  const copy = path.join(work, 'board')
  cpSync(boardDir, copy, { recursive: true })
  const here = path.dirname(new URL(import.meta.url).pathname)
  const tsx = path.join(viewerDir, 'node_modules/.bin/tsx')
  const child = spawn(tsx, [path.join(here, 'start-gcanvas.ts'), copy], {
    env: { ...process.env, GCANVAS_REPO: path.dirname(viewerDir) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (c) => (stderr += c))
  const url = await new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`启动上游超时：${stderr}`)), 60000)
    child.stdout.on('data', (c) => {
      buf += c
      const m = /GCANVAS_URL=(\S+)/.exec(buf)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    child.on('exit', (code) => reject(new Error(`上游进程提前退出(${code})：${stderr}`)))
  })
  const stop = async () => {
    child.removeAllListeners('exit')
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 1200))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  return { url, copy, work, stop }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.out || (!args.url && !args.gcanvas)) {
    console.error('用法：extract.mjs (--url <地址> | --gcanvas <画板目录>) --out <json> [--shots <目录>] [--expect N] [--save-canvas <路径>] [--viewport WxH]')
    process.exit(2)
  }
  const [vw, vh] = String(args.viewport ?? '1800x1100').split('x').map(Number)
  const pkgDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
  const repoDir = path.resolve(args['gcanvas-repo'] ?? (process.env.GCANVAS_REPO || path.resolve(pkgDir, '../../../html_canvas')))
  const viewerDir = path.join(repoDir, 'viewer')
  let expect = args.expect != null ? Number(args.expect) : null
  let upstream = null
  let url = args.url
  if (args.gcanvas) {
    if (!existsSync(path.join(viewerDir, 'node_modules/.bin/tsx'))) {
      console.error(`找不到 G-canvas 上游（${repoDir}）。设 GCANVAS_REPO 或传 --gcanvas-repo。`)
      process.exit(2)
    }
    const doc = JSON.parse(readFileSync(path.join(args.gcanvas, 'canvas.json'), 'utf8'))
    if (expect == null) expect = doc.elements.length
    upstream = await startGcanvas(path.resolve(args.gcanvas), viewerDir)
    url = upstream.url
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 })
    const consoleErrors = []
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForSelector('.hc-stage .hc-world', { state: 'attached', timeout: 30000 })
    const snap = await waitStable(page, expect)
    const out = {
      meta: { source: args.gcanvas ? 'gcanvas' : 'url', url: url.replace(/#.*/, ''), viewport: { w: vw, h: vh }, expect, consoleErrors },
      camera: snap.camera,
      order: snap.order,
      elements: snap.elements,
    }
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
    writeFileSync(args.out, JSON.stringify(out, null, 2))
    console.log(`已导出 ${snap.order.length} 个元素 -> ${args.out}（缩放 ${snap.camera.zoom}）`)
    if (args.shots) {
      await takeShots(page, snap, args.shots)
      console.log(`截图 -> ${args.shots}`)
    }
    if (consoleErrors.length) console.warn(`页面 console 错误 ${consoleErrors.length} 条（见 JSON meta.consoleErrors）`)
    if (args['save-canvas'] && upstream) {
      await page.waitForTimeout(1500) // 等 measured 写盘
      writeFileSync(args['save-canvas'], readFileSync(path.join(upstream.copy, 'canvas.json')))
      console.log(`写回后的 canvas.json -> ${args['save-canvas']}`)
    }
  } finally {
    await browser.close()
    if (upstream) {
      await upstream.stop()
      rmSync(upstream.work, { recursive: true, force: true })
    }
  }
}

main().catch((e) => {
  console.error(e.stack ?? String(e))
  process.exit(1)
})

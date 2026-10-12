#!/usr/bin/env node
/**
 * side-by-side —— 把两侧同名截图拼成左右对照图（左 G-canvas，右 PRD-Lab，顶部标注元素 id）。
 *
 * 用法：
 *   node side-by-side.mjs --left <G-canvas 截图目录> --right <PRD-Lab 截图目录> --out <输出目录> [--ids board,a3,t2]
 *
 * --ids 里的名字对应截图文件：board -> board.png，其余 <id> -> el-<id>.png。
 * 用 Playwright 渲染一个本地 HTML 后截图，不依赖其它库。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1]
if (!args.left || !args.right || !args.out) {
  console.error('用法：side-by-side.mjs --left <目录> --right <目录> --out <目录> [--ids board,a3,...]')
  process.exit(2)
}
const ids = (args.ids ?? 'board').split(',')
const fileOf = (id) => (id === 'board' ? 'board.png' : `el-${id}.png`)
mkdirSync(args.out, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'parity-sbs-'))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } })
  for (const id of ids) {
    const l = path.resolve(args.left, fileOf(id))
    const r = path.resolve(args.right, fileOf(id))
    if (!existsSync(l) || !existsSync(r)) {
      console.warn(`跳过 ${id}：截图缺失`)
      continue
    }
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:12px;background:#fff;font:14px system-ui,sans-serif;display:inline-block}
      h1{margin:0 0 8px;font-size:18px} .row{display:flex;gap:16px;align-items:flex-start}
      figure{margin:0} figcaption{font-weight:600;margin-bottom:4px;color:#555}
      img{display:block;border:1px solid #ccc}</style>
      <h1>${id}</h1><div class="row">
      <figure><figcaption>G-canvas</figcaption><img src="file://${l}"></figure>
      <figure><figcaption>PRD-Lab</figcaption><img src="file://${r}"></figure></div>`
    const f = path.join(tmp, `${id}.html`)
    writeFileSync(f, html)
    await page.goto(`file://${f}`)
    await page.waitForFunction(() => [...document.images].every((i) => i.complete))
    await page.locator('body').screenshot({ path: path.join(args.out, `${id}.png`) })
    console.log(`${id} -> ${path.join(args.out, `${id}.png`)}`)
  }
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}

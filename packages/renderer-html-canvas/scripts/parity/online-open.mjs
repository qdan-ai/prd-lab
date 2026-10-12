#!/usr/bin/env node
/**
 * online-open —— 打开 PRD-Lab 分享链接，截分享页，点「打开画板」进预览站，截整板并导出 JSON。
 *
 * 用法：node online-open.mjs --share <分享链接> --out <输出目录> [--expect N] [--viewport WxH]
 * 只读浏览：只点「打开画板」，不做其它操作。产物：share.png、board.png、extract JSON（online.json）、
 * flow.json（步骤、预览站 URL 形态，token 已脱敏）。导出 JSON 需页面符合 extract.mjs 的 DOM 约定，否则如实记录失败。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const args = {}
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1]
if (!args.share || !args.out) {
  console.error('用法：online-open.mjs --share <分享链接> --out <目录> [--expect N] [--viewport WxH]')
  process.exit(2)
}
const [vw, vh] = (args.viewport ?? '1800x1100').split('x').map(Number)
mkdirSync(args.out, { recursive: true })
const mask = (u) => u.replace(/(token=)[^&#]+/gi, '$1<TOKEN>').replace(/(\/share\/)[^/?#]+/, '$1<SHARE_ID>')
const flow = { steps: [], consoleErrors: [] }

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => flow.consoleErrors.push(String(e)))
  await page.goto(args.share, { waitUntil: 'networkidle' })
  flow.steps.push({ step: '打开分享页', url: mask(page.url()), title: await page.title() })
  await page.screenshot({ path: path.join(args.out, 'share.png'), fullPage: true })
  flow.shareText = (await page.innerText('body')).slice(0, 600)

  const btn = page.getByRole('button', { name: /打开画板/ }).or(page.getByRole('link', { name: /打开画板/ })).first()
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }).catch(() => null), btn.click()])
  const board = popup ?? page
  flow.steps.push({ step: '点击「打开画板」', newWindow: !!popup })
  await board.setViewportSize({ width: vw, height: vh })
  await board.waitForLoadState('load').catch(() => {})
  await board.waitForTimeout(8000)
  flow.steps.push({ step: '预览页', url: mask(board.url()), title: await board.title() })
  flow.hasStage = (await board.locator('.hc-stage').count()) > 0
  await board.screenshot({ path: path.join(args.out, 'board.png') })
  // 带 token 的真实地址只用于本次进程内导出，不落盘
  const real = board.url()
  writeFileSync(path.join(args.out, 'flow.json'), JSON.stringify(flow, null, 2))
  await browser.close()
  const ex = spawnSync(
    'node',
    [path.join(path.dirname(new URL(import.meta.url).pathname), 'extract.mjs'), '--url', real, '--out', path.join(args.out, 'online.json'), ...(args.expect ? ['--expect', args.expect] : [])],
    { encoding: 'utf8', timeout: 120000 },
  )
  flow.extract = { exit: ex.status, output: (ex.stdout + ex.stderr).replace(/token=[^&\s#]+/gi, 'token=<TOKEN>').slice(-800) }
  writeFileSync(path.join(args.out, 'flow.json'), JSON.stringify(flow, null, 2))
  console.log(JSON.stringify(flow, null, 2))
} catch (e) {
  flow.error = String(e).replace(/token=[^&\s#]+/gi, 'token=<TOKEN>')
  writeFileSync(path.join(args.out, 'flow.json'), JSON.stringify(flow, null, 2))
  console.error(flow.error)
  await browser.close().catch(() => {})
  process.exit(1)
}

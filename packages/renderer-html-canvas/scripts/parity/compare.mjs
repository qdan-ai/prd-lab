#!/usr/bin/env node
/**
 * compare —— 比对两份 extract 导出的 JSON，逐元素列出不一致项。
 *
 * 用法：
 *   node compare.mjs <基准.json> <对照.json> [--out report.md] [--tol 1] [--style-tol 0.1] [--ignore <正则>]
 *
 * 基准通常是 G-canvas 一侧，对照是 PRD-Lab 查看器一侧。
 * --tol         几何容差（世界像素），作用于位置/尺寸/箭头路径坐标，缺省 1。
 * --style-tol   其它 px 数值（字号、线宽、行高等）容差，缺省 0.1。
 * --ignore      忽略匹配此正则的字段路径（如 '^[^.]+\.html\.text$'），可重复。
 * 退出码：0 无差异；1 有差异；2 用法错误。
 * 不比较 camera / meta（两边画布大小与首屏缩放本就不同）；比较元素集合、图层顺序与每个元素的字段。
 */
import { readFileSync, writeFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = { _: [], ignore: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      args._.push(a)
      continue
    }
    const key = a.slice(2)
    const val = argv[++i]
    if (key === 'ignore') args.ignore.push(val)
    else args[key] = val
  }
  return args
}

/** 把嵌套对象拍平成 path → 叶子值（数组按下标）。 */
function flatten(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)
    if (entries.length === 0) out[prefix] = Array.isArray(value) ? '[]' : '{}'
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else {
    out[prefix] = value
  }
  return out
}

const GEOMETRY_PATH = /(^|\.)(box|hostBox|center|natural|size)(\.|$)|(^|\.)width$/
const PX = /^(-?\d*\.?\d+)px$/

function normHtml(s) {
  return s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
}

function comparePathD(a, b, tol) {
  const ta = a.split(/\s+/).filter(Boolean)
  const tb = b.split(/\s+/).filter(Boolean)
  if (ta.length !== tb.length) return `段数不同（${ta.length} vs ${tb.length} 个记号）`
  for (let i = 0; i < ta.length; i++) {
    const na = Number(ta[i])
    const nb = Number(tb[i])
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      if (ta[i] !== tb[i]) return `命令不同：第 ${i} 个记号 ${ta[i]} vs ${tb[i]}`
    } else if (Math.abs(na - nb) > tol) {
      return `坐标超差：第 ${i} 个记号 ${na} vs ${nb}（差 ${Math.abs(na - nb).toFixed(2)}）`
    }
  }
  return null
}

/** 返回 null 表示一致，否则返回差异说明。 */
function diffLeaf(path, a, b, tol, styleTol) {
  if (a === b) return null
  if (typeof a === 'number' && typeof b === 'number') {
    const t = GEOMETRY_PATH.test(path) ? tol : styleTol
    return Math.abs(a - b) <= t ? null : `差 ${(b - a).toFixed(2)}（容差 ${t}）`
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (/(^|\.)arrow\.d$/.test(path)) return comparePathD(a, b, tol)
    if (/(^|\.)text\.html$/.test(path)) return normHtml(a) === normHtml(b) ? null : '内容 HTML 不同'
    const ma = PX.exec(a)
    const mb = PX.exec(b)
    if (ma && mb) return Math.abs(Number(ma[1]) - Number(mb[1])) <= styleTol ? null : `差 ${(Number(mb[1]) - Number(ma[1])).toFixed(2)}px`
  }
  return '值不同'
}

function fmt(v) {
  if (v === undefined) return '（缺失）'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 160 ? `${s.slice(0, 157)}...` : s
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args._.length !== 2) {
    console.error('用法：compare.mjs <基准.json> <对照.json> [--out report.md] [--tol 1] [--style-tol 0.1] [--ignore <正则>]')
    process.exit(2)
  }
  const tol = Number(args.tol ?? 1)
  const styleTol = Number(args['style-tol'] ?? 0.1)
  const ignore = args.ignore.map((r) => new RegExp(r))
  const A = JSON.parse(readFileSync(args._[0], 'utf8'))
  const B = JSON.parse(readFileSync(args._[1], 'utf8'))

  const problems = [] // { id, type, items: [{path, a, b, note}] }
  const idsA = Object.keys(A.elements)
  const idsB = Object.keys(B.elements)

  for (const id of idsA.filter((i) => !B.elements[i])) problems.push({ id, type: A.elements[id].type, items: [{ path: '(元素)', a: '存在', b: '缺失', note: '对照侧没有此元素' }] })
  for (const id of idsB.filter((i) => !A.elements[i])) problems.push({ id, type: B.elements[id].type, items: [{ path: '(元素)', a: '缺失', b: '存在', note: '基准侧没有此元素' }] })

  const orderA = A.order.filter((i) => B.elements[i])
  const orderB = B.order.filter((i) => A.elements[i])
  if (orderA.join() !== orderB.join()) problems.push({ id: '(图层顺序)', type: '-', items: [{ path: 'order', a: orderA.join(' '), b: orderB.join(' '), note: '元素 DOM 顺序不同，图层遮挡会不一致' }] })

  let compared = 0
  for (const id of idsA.filter((i) => B.elements[i])) {
    compared++
    const fa = flatten(A.elements[id])
    const fb = flatten(B.elements[id])
    const items = []
    for (const path of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (ignore.some((r) => r.test(`${id}.${path}`) || r.test(path))) continue
      const note = path in fa && path in fb ? diffLeaf(path, fa[path], fb[path], tol, styleTol) : '一侧缺少该字段'
      if (note) items.push({ path, a: fa[path], b: fb[path], note })
    }
    if (items.length) problems.push({ id, type: A.elements[id].type, items })
  }

  const lines = []
  lines.push('# G-canvas vs PRD-Lab 对照报告', '')
  lines.push(`- 基准：\`${args._[0]}\`（${A.meta?.source ?? '?'}，${idsA.length} 个元素）`)
  lines.push(`- 对照：\`${args._[1]}\`（${B.meta?.source ?? '?'}，${idsB.length} 个元素）`)
  lines.push(`- 几何容差 ${tol} 世界像素，样式数值容差 ${styleTol}；相机：基准 zoom ${A.camera?.zoom}，对照 zoom ${B.camera?.zoom}（仅供参考，不参与比对）`)
  const total = problems.reduce((n, p) => n + p.items.length, 0)
  lines.push(`- 结果：${problems.length === 0 ? '**零差异**' : `**${problems.length} 个元素/项有差异，共 ${total} 处**`}（已逐项比对 ${compared} 个元素）`, '')
  for (const p of problems) {
    lines.push(`## ${p.id}（${p.type}）`, '', '| 字段 | G-canvas | PRD-Lab | 说明 |', '|---|---|---|---|')
    for (const it of p.items) lines.push(`| \`${it.path}\` | ${fmt(it.a).replace(/\|/g, '\\|')} | ${fmt(it.b).replace(/\|/g, '\\|')} | ${it.note} |`)
    lines.push('')
  }
  const report = lines.join('\n')
  if (args.out) writeFileSync(args.out, report)
  console.log(report)
  process.exit(problems.length ? 1 : 0)
}

main()

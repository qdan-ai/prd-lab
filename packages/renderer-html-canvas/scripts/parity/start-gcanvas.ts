/**
 * 以开发态启动 G-canvas 上游并注册一份画板，打印可直接打开的页面地址。
 *
 * 用法（必须用上游自己的 tsx，才能解析上游依赖）：
 *   <上游>/viewer/node_modules/.bin/tsx start-gcanvas.ts <画板目录>
 *
 * - 随机端口、不写生产发现文件；画板目录会被上游写回 measured，请传临时副本。
 * - 上游仓库根目录由环境变量 GCANVAS_REPO 指定，缺省与 prd-lab 同级的 ../html_canvas。
 * - stdout 输出一行 `GCANVAS_URL=<地址>`；SIGINT/SIGTERM 时优雅退出。
 */
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const pkgDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const viewer = path.join(process.env['GCANVAS_REPO'] || path.resolve(pkgDir, '../../../html_canvas'), 'viewer')
const boardDir = process.argv[2]
if (!boardDir) {
  console.error('用法：start-gcanvas.ts <画板目录>')
  process.exit(2)
}

const { serviceWorkDir } = await import(path.join(viewer, 'server/service-work-dir.ts'))
const { startServer } = await import(path.join(viewer, 'server/index.ts'))
const { UI_PASS_FRAGMENT_KEY } = await import(path.join(viewer, 'src/shared/ui-pass.ts'))
const { checkedTarget } = await import(path.join(viewer, 'src/shared/checked-target.ts'))

process.chdir(serviceWorkDir(os.homedir()))
const started = await startServer(path.resolve(boardDir), 0)
const base = `http://127.0.0.1:${started.port}`
const target = await checkedTarget(base)
const res = await target.fetch(`${base}/api/boards`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ path: path.resolve(boardDir) }),
})
if (res.status !== 200) {
  console.error(`注册画板失败（HTTP ${res.status}）：${await res.text()}`)
  process.exit(1)
}
const body = (await res.json()) as { boards: { id: string }[] }
const focusId = body.boards[0]?.id
console.log(`GCANVAS_URL=${base}/?focus=${focusId}#${UI_PASS_FRAGMENT_KEY}=${started.uiPass}`)

const stop = () => {
  try {
    started.stop()
    started.server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  } catch {
    process.exit(0)
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

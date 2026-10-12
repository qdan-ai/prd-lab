#!/usr/bin/env node
/**
 * G-canvas 渲染件同步 / 漂移检查。
 *
 * 查看器（本包）渲染画板所用的引擎与渲染组件逐字复制自 G-canvas 仓库（html_canvas）的 viewer/src/，
 * 清单 gcanvas-sync.json 记录每个文件的来源与哈希。本脚本只读上游仓库的**已提交内容**
 * （git show <commit>:<path>），从不读上游工作区、从不写上游仓库。
 *
 * 用法：
 *   node scripts/gcanvas-sync.mjs check [--repo <path>] [--commit <rev>]
 *     比对上游 <rev>（缺省 HEAD）与清单，任一漂移即非零退出。
 *   node scripts/gcanvas-sync.mjs sync  [--repo <path>] [--commit <rev>] [--accept]
 *     从上游 <rev>（缺省 HEAD）覆盖写入逐字件并更新其哈希；改写件 / 垫片 / 监视目录只报告变化。
 *     改写件与垫片各自记录「已对照到的上游 commit」（reconciledCommit），报红时给出可直接执行的
 *     git diff 命令；人工对照完后加 --accept，才把它们（及监视目录）的上游现状记入清单。
 *
 * check 另以「提示」列出逐字件引用的 npm 包在上游 package.json 与本包 package.json 的声明差异
 * （不报红、不影响退出码）。
 *
 * 上游仓库：--repo > 环境变量 GCANVAS_REPO > 与 prd-lab 同级的 ../html_canvas。
 * 未用 --repo 指定且仓库不存在时打印「跳过」并以 0 退出（构建服务器上没有上游仓库）。
 *
 * 退出码：0 一致 / 已同步；1 有漂移或需人工处理；2 参数或环境错误。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(PKG_DIR, 'gcanvas-sync.json')
const DEFAULT_REPO = path.resolve(PKG_DIR, '../../../html_canvas')

const KIND_LABEL = { verbatim: '逐字件', adapted: '改写件', shim: '垫片' }

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [mode, ...rest] = argv
  const opts = { mode, repo: null, commit: 'HEAD', accept: false }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--') continue // pnpm run 透传参数时带的分隔符
    else if (a === '--repo') opts.repo = rest[++i]
    else if (a === '--commit') opts.commit = rest[++i]
    else if (a === '--accept') opts.accept = true
    else throw new UsageError(`未知参数：${a}`)
  }
  if (mode !== 'check' && mode !== 'sync') throw new UsageError('第一个参数必须是 check 或 sync')
  if (opts.repo === undefined || opts.commit === undefined) throw new UsageError('--repo / --commit 缺少取值')
  if (opts.accept && mode !== 'sync') throw new UsageError('--accept 只用于 sync')
  return opts
}

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// 上游仓库（只读已提交对象）
// ---------------------------------------------------------------------------

function git(repo, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

function resolveCommit(repo, rev) {
  return git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim()
}

/** 上游文件字节；该 commit 下不存在返回 null */
function readUpstream(repo, commit, upstreamPath) {
  try {
    return git(repo, ['show', `${commit}:${upstreamPath}`], 'buffer')
  } catch {
    return null
  }
}

/** 上游某目录（递归）在该 commit 下的文件路径列表 */
function listUpstream(repo, commit, dir) {
  const out = git(repo, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', commit, '--', dir])
  return out.split('\n').filter(Boolean)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ---------------------------------------------------------------------------
// 清单
// ---------------------------------------------------------------------------

const KINDS = new Set(['verbatim', 'adapted', 'shim'])

/** 读清单并核对结构；写坏时给出人话报错（退出码 2，与「有漂移」区分） */
function loadManifest() {
  const where = MANIFEST_PATH
  let m
  try {
    m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (err) {
    throw new UsageError(`清单 ${where} 读取失败或不是合法 JSON：${err instanceof Error ? err.message : String(err)}`)
  }
  const bad = (msg) => new UsageError(`清单 ${where} 结构不对：${msg}`)
  if (typeof m !== 'object' || m === null) throw bad('顶层必须是对象')
  if (typeof m.upstream?.commit !== 'string') throw bad('缺少 upstream.commit（字符串）')
  if (!Array.isArray(m.files)) throw bad('files 必须是数组')
  m.files.forEach((f, i) => {
    const at = `files[${i}]${typeof f?.upstream === 'string' ? `（${f.upstream}）` : ''}`
    if (typeof f?.upstream !== 'string' || typeof f?.local !== 'string') throw bad(`${at} 需要 upstream 与 local 两个路径字符串`)
    if (!KINDS.has(f.kind)) throw bad(`${at} 的 kind 为 ${JSON.stringify(f.kind)}，只能是 verbatim / adapted / shim`)
  })
  if (m.watch !== undefined && !Array.isArray(m.watch)) throw bad('watch 必须是数组')
  for (const [i, w] of (m.watch ?? []).entries()) {
    if (typeof w?.dir !== 'string') throw bad(`watch[${i}] 缺少 dir`)
  }
  return m
}

function saveManifest(m) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2) + '\n')
}

function watchedNow(repo, commit, w) {
  const exclude = w.exclude ? new RegExp(w.exclude) : null
  const include = w.include ? new RegExp(w.include) : null
  return listUpstream(repo, commit, w.dir)
    .filter((p) => {
      const name = p.slice(w.dir.length + 1)
      if (exclude && exclude.test(name)) return false
      if (include && !include.test(name)) return false
      return true
    })
    .sort()
}

// ---------------------------------------------------------------------------
// 逐字件的相对引用闭包：引用到的本地文件必须存在（上游新增依赖时提示补进清单）
// ---------------------------------------------------------------------------

// 只认行首的 import/export 语句（注释里出现的 import 字样不算）
const IMPORT_RE = /^\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm
const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g

function missingRelativeImports(localAbs) {
  const ext = path.extname(localAbs)
  const text = readFileSync(localAbs, 'utf8')
  const dir = path.dirname(localAbs)
  const missing = []
  if (ext === '.ts' || ext === '.tsx') {
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]
      const base = path.resolve(dir, spec)
      const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
      if (!candidates.some((c) => existsSync(c) && statSync(c).isFile())) missing.push(spec)
    }
  } else if (ext === '.css') {
    for (const m of text.matchAll(CSS_URL_RE)) {
      const spec = m[1].trim()
      if (!spec.startsWith('.')) continue
      const clean = spec.split(/[?#]/)[0]
      if (!existsSync(path.resolve(dir, clean))) missing.push(spec)
    }
  }
  return missing
}

// ---------------------------------------------------------------------------
// 比对
// ---------------------------------------------------------------------------

/**
 * 逐项比对，返回问题列表。每个问题：{ file, kind, what, fix }（全是给人看的话）。
 * fetched 收集逐字件的上游字节，sync 复用。
 */
function compare(repo, commit, manifest, fetched) {
  const short = commit.slice(0, 7)
  const problems = []
  for (const f of manifest.files) {
    const label = KIND_LABEL[f.kind] ?? f.kind
    const buf = readUpstream(repo, commit, f.upstream)
    if (!buf) {
      problems.push({
        file: f.upstream,
        kind: label,
        what: '上游已删除或改名',
        fix: '到上游确认去向，改清单里的 upstream 路径或移除该项，并相应调整本地文件',
      })
      continue
    }
    fetched.set(f.upstream, buf)
    const upSha = sha256(buf)
    const localAbs = path.join(PKG_DIR, f.local)

    if (f.kind === 'verbatim') {
      if (!existsSync(localAbs)) {
        problems.push({ file: f.local, kind: label, what: '本地文件缺失', fix: '跑 sync 恢复' })
      } else if (f.upstreamSha256 && sha256(readFileSync(localAbs)) !== f.upstreamSha256) {
        problems.push({
          file: f.local,
          kind: label,
          what: '本地逐字件被手改（与清单哈希不符）',
          fix: '逐字件不许手改：撤销改动后跑 sync；确需改动就把它转为 adapted 改写件并写明理由',
        })
      }
      if (upSha !== f.upstreamSha256) {
        problems.push({
          file: f.upstream,
          kind: label,
          what: f.upstreamSha256 ? '上游内容已变' : '清单尚无哈希（新加入的文件）',
          fix: '跑 sync 覆盖写入，再跑 typecheck / 测试确认没破坏查看器',
        })
      }
    } else {
      if (!existsSync(localAbs)) {
        problems.push({ file: f.local, kind: label, what: '本地文件缺失', fix: '恢复本地文件（它是 PRD-Lab 自有代码，不由 sync 生成）' })
      }
      if (upSha !== f.upstreamSha256) {
        const base = f.reconciledCommit
        const diffCmd = base
          ? `git -C ${JSON.stringify(repo)} diff ${base.slice(0, 7)} ${short} -- ${f.upstream}`
          : null
        problems.push({
          file: f.upstream,
          kind: label,
          what: f.upstreamSha256
            ? `对应的上游文件已变（本地 ${f.local}，已对照到 ${base ? base.slice(0, 7) : '未知 commit'}）`
            : '清单尚无上游哈希',
          fix:
            (f.kind === 'shim'
              ? '对照上游接口变化，按需给垫片补字段/导出'
              : '人工对照上游改动，把需要的部分搬进改写件') +
            (diffCmd ? `（看改动：${diffCmd}）` : '') +
            '；改完跑 sync --accept 记入',
        })
      }
    }
  }

  for (const w of manifest.watch ?? []) {
    const now = watchedNow(repo, commit, w)
    const known = new Set(w.files ?? [])
    const nowSet = new Set(now)
    for (const p of now) {
      if (!known.has(p)) {
        problems.push({
          file: p,
          kind: '监视目录',
          what: `上游 ${w.dir}/ 出现清单外的新文件`,
          fix: w.hint ?? '判断渲染是否需要：需要就加进清单 files 再跑 sync；不需要就跑 sync --accept 记入已知文件',
        })
      }
    }
    for (const p of known) {
      if (!nowSet.has(p)) {
        problems.push({
          file: p,
          kind: '监视目录',
          what: `上游 ${w.dir}/ 删除了该文件`,
          fix: '确认查看器是否仍依赖它；处理后跑 sync --accept',
        })
      }
    }
  }

  for (const f of manifest.files) {
    if (f.kind !== 'verbatim') continue
    const localAbs = path.join(PKG_DIR, f.local)
    if (!existsSync(localAbs)) continue
    for (const spec of missingRelativeImports(localAbs)) {
      problems.push({
        file: f.local,
        kind: KIND_LABEL.verbatim,
        what: `引用了本地不存在的 ${spec}`,
        fix: '上游新增了依赖文件：把它加进清单 files（逐字或垫片）再跑 sync',
      })
    }
  }
  return problems
}

/**
 * 逐字件实际引用的 npm 包：上游 package.json 与本包 package.json 的声明范围差异（只提示）。
 * 包名取自本地逐字件的 import（`@scope/name` 或首段），只比对渲染链真正用到的包。
 */
function dependencyHints(repo, commit, manifest) {
  const upPath = manifest.deps?.upstreamPackageJson
  if (!upPath) return []
  const upBuf = readUpstream(repo, commit, upPath)
  if (!upBuf) return [`上游 ${upPath} 不存在，跳过依赖比对`]
  let upPkg
  try {
    upPkg = JSON.parse(upBuf.toString('utf8'))
  } catch {
    return [`上游 ${upPath} 不是合法 JSON，跳过依赖比对`]
  }
  const localPkgPath = path.join(PKG_DIR, 'package.json')
  const localPkg = existsSync(localPkgPath) ? JSON.parse(readFileSync(localPkgPath, 'utf8')) : {}
  const declared = (pkg) => ({ ...pkg.devDependencies, ...pkg.dependencies })
  const up = declared(upPkg)
  const local = declared(localPkg)

  const names = new Set()
  for (const f of manifest.files) {
    if (f.kind !== 'verbatim' || !/\.(ts|tsx)$/.test(f.local)) continue
    const localAbs = path.join(PKG_DIR, f.local)
    if (!existsSync(localAbs)) continue
    for (const m of readFileSync(localAbs, 'utf8').matchAll(BARE_IMPORT_RE)) {
      const spec = m[1] ?? m[2]
      const parts = spec.split('/')
      names.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
  }

  const hints = []
  for (const name of [...names].sort()) {
    const u = up[name]
    const l = local[name]
    if (u === undefined) continue
    if (l === undefined) hints.push(`${name}：上游声明 ${u}，本包未声明`)
    else if (u !== l) hints.push(`${name}：上游声明 ${u}，本包声明 ${l}`)
  }
  return hints
}

const BARE_IMPORT_RE = /^\s*(?:import|export)\s[^;]*?from\s*['"]([^.'"][^'"]*)['"]|^\s*import\s*['"]([^.'"][^'"]*)['"]/gm

function printHints(hints) {
  if (hints.length === 0) return
  console.log(`  提示（不影响结果）：渲染链依赖的声明版本与上游不同，需要时对齐本包 package.json：`)
  for (const h of hints) console.log(`    · ${h}`)
}

function printProblems(problems) {
  for (const p of problems) {
    console.log(`  ✗ [${p.kind}] ${p.file}\n      问题：${p.what}\n      处理：${p.fix}`)
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function locateRepo(opts) {
  const explicit = opts.repo != null
  const repo = path.resolve(opts.repo ?? (process.env.GCANVAS_REPO || DEFAULT_REPO))
  const isRepo = existsSync(repo) && (() => {
    try {
      git(repo, ['rev-parse', '--git-dir'])
      return true
    } catch {
      return false
    }
  })()
  if (isRepo) return repo
  if (explicit) throw new UsageError(`--repo 指向的不是 git 仓库：${repo}`)
  console.log(`[gcanvas-sync] 跳过：找不到 G-canvas 仓库（${repo}）。本机没有上游仓库时无法比对；需要时设 GCANVAS_REPO 或传 --repo。`)
  return null
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const repo = locateRepo(opts)
  if (!repo) return 0

  let commit
  try {
    commit = resolveCommit(repo, opts.commit)
  } catch {
    throw new UsageError(`上游仓库里找不到 commit：${opts.commit}`)
  }
  const manifest = loadManifest()
  const fetched = new Map()
  const short = commit.slice(0, 7)

  if (opts.mode === 'check') {
    const problems = compare(repo, commit, manifest, fetched)
    const hints = dependencyHints(repo, commit, manifest)
    if (problems.length === 0) {
      console.log(`[gcanvas-sync] 一致：清单（同步自 ${manifest.upstream.commit.slice(0, 7)}）与上游 ${short} 无漂移，共 ${manifest.files.length} 个文件。`)
      printHints(hints)
      return 0
    }
    console.log(`[gcanvas-sync] 漂移：清单（同步自 ${manifest.upstream.commit.slice(0, 7)}）与上游 ${short} 有 ${problems.length} 处不一致：`)
    printProblems(problems)
    printHints(hints)
    return 1
  }

  // sync：逐字件覆盖写入；改写件 / 垫片 / 监视目录只报告（--accept 才记入）
  const before = compare(repo, commit, manifest, fetched)
  const handEdited = new Set(before.filter((p) => p.what.startsWith('本地逐字件被手改')).map((p) => p.file))
  const written = []
  for (const f of manifest.files) {
    const buf = fetched.get(f.upstream)
    if (!buf) continue
    const upSha = sha256(buf)
    if (f.kind === 'verbatim') {
      const localAbs = path.join(PKG_DIR, f.local)
      const localSha = existsSync(localAbs) ? sha256(readFileSync(localAbs)) : null
      if (localSha !== upSha) {
        mkdirSync(path.dirname(localAbs), { recursive: true })
        writeFileSync(localAbs, buf)
        written.push(handEdited.has(f.local) ? `${f.local}（覆盖了本地手改）` : f.local)
      }
      f.upstreamSha256 = upSha
    } else if (!f.upstreamSha256 || opts.accept) {
      // 改写件 / 垫片：只有首次登记或人工对照完（--accept）才推进对照基准
      f.upstreamSha256 = upSha
      f.reconciledCommit = commit
    }
  }
  if (opts.accept) {
    for (const w of manifest.watch ?? []) w.files = watchedNow(repo, commit, w)
  } else {
    for (const w of manifest.watch ?? []) if (!w.files) w.files = watchedNow(repo, commit, w)
  }
  // upstream.commit = 逐字件同步到的 commit；改写件 / 垫片的对照基准各自记在 reconciledCommit
  manifest.upstream.commit = commit
  saveManifest(manifest)

  console.log(`[gcanvas-sync] 已从上游 ${short} 同步：覆盖写入 ${written.length} 个逐字件。`)
  for (const p of written) console.log(`  ↻ ${p}`)

  const after = compare(repo, commit, manifest, new Map())
  if (after.length === 0) {
    if (before.length > 0) console.log('  同步后与上游一致。记得跑 typecheck 与测试。')
    return 0
  }
  console.log(`  仍有 ${after.length} 处需人工处理：`)
  printProblems(after)
  return 1
}

try {
  process.exitCode = main()
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`[gcanvas-sync] ${err.message}`)
    console.error('用法：node scripts/gcanvas-sync.mjs <check|sync> [--repo <path>] [--commit <rev>] [--accept]')
    process.exitCode = 2
  } else {
    throw err
  }
}

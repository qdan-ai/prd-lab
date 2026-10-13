/**
 * 【改写件 · PRD-Lab 自有，对应上游 ui/canvas/note/note-loader.ts】
 * 与上游逐行相同，只有判 404 的错误类型不同：上游用 persistence/adapter 的 HttpStatusError，
 * 这里用查看器 api.ts 的 FetchError（同样带 status）；adapter 类型取 Pick<CanvasAdapter, 'loadNote'>。
 *
 * 标注正文加载器 —— 把 notes/x.md 的磁盘内容读进 NoteContentCache，并提供渲染侧的订阅钩子。
 *
 * 职责只有「读」：自写（提交 / 撤销 / 重做）由 session 登记进缓存；本模块负责首次加载、
 * 外部改动 / 撤销恢复后的重读、以及缓存被标 stale 后的自动重读。
 *
 * 防旧结果覆盖：发请求前记下缓存的确认值版本，回来时版本已变（期间有自写确认）则丢弃。
 * 同文件在途请求合并；在途时又来 reload，则在途完成后再读一次，保证拿到最新磁盘内容。
 */
import type { NoteContentCache } from '../../../engine/note-content-cache'
import { FetchError } from '../../../../api'
import type { CanvasAdapter } from '../canvas-context'

export interface NoteLoader {
  /** 缓存里没有该文件（或仍是未发请求的加载态）才发请求 */
  ensure(file: string): void
  /** 重读磁盘：已有 ready 内容时保持显示，回来再换新 */
  reload(file: string): void
  /** 停止响应缓存变化；在途结果不再写缓存 */
  dispose(): void
}

export function createNoteLoader(opts: {
  adapter: Pick<CanvasAdapter, 'loadNote'>
  boardId: string
  cache: NoteContentCache
}): NoteLoader {
  const { adapter, boardId, cache } = opts
  let disposed = false
  /** 在途请求：again = 在途期间又收到 reload，完成后需再读一次 */
  const inflight = new Map<string, { again: boolean }>()

  const run = (file: string): void => {
    const slot = { again: false }
    inflight.set(file, slot)
    cache.noteLoading(file)
    const version = cache.version(file)
    adapter.loadNote(boardId, file).then(
      (content) => settle(file, slot, version, () => cache.noteLoaded(file, content)),
      (err: unknown) =>
        settle(file, slot, version, () => {
          if (err instanceof FetchError && err.status === 404) cache.noteMissing(file)
          else cache.noteError(file, err instanceof Error ? err.message : String(err))
        }),
    )
  }

  const settle = (file: string, slot: { again: boolean }, version: number, apply: () => void): void => {
    if (inflight.get(file) === slot) inflight.delete(file)
    if (disposed) return
    // 期间有自写确认：读到的是确认之前的磁盘内容，丢弃
    if (cache.version(file) === version) apply()
    if (slot.again) run(file)
  }

  const reload = (file: string): void => {
    if (disposed) return
    const slot = inflight.get(file)
    if (slot) {
      slot.again = true
      return
    }
    run(file)
  }

  const unsubscribe = cache.subscribe((file) => {
    if (disposed) return
    if (cache.peek(file)?.stale) reload(file)
  })

  return {
    ensure(file) {
      if (disposed || inflight.has(file)) return
      const snap = cache.peek(file)
      if (snap && snap.entry.state !== 'loading') return
      run(file)
    },
    reload,
    dispose() {
      disposed = true
      unsubscribe()
      inflight.clear()
    },
  }
}

/**
 * 标注正文缓存 —— 前端持有「每份标注正文（notes/x.md）当前是什么」的同步可读镜像
 *
 * 作用：让撤销栈在同步段就能读到正文现状（撤销 / 重做预检），并让提交进入落盘前就能把乐观结果显示出来。
 * 纯 TS、无 IO：磁盘读取由界面层的 loader 负责，loader 把结果登记进来；session 经 setPending / confirm /
 * dropPending 登记自写。
 *
 * 一个文件的状态 = 确认值（entry，来自磁盘读或自写成功）+ 待定值队列（已提交、尚未落盘确认的乐观正文）。
 *   当前正文 = 最后一个待定值，没有待定值则取 ready 的确认值。
 * 待定值按 token（对象身份）区分：同一文件上排队的多次写（提交 → 撤销 → 重做）各占一个 token，
 * 各自落盘成功后只确认自己，不会误清后面还在排队的待定值。
 *
 * key 一律用画板根视角路径 notes/<文件名>.md。
 */

export type NoteEntry =
  | { state: 'loading' }
  | { state: 'ready'; content: string }
  | { state: 'missing' }
  | { state: 'error'; message: string }

export interface NoteSnapshot {
  entry: NoteEntry
  /** 当前应显示的正文：有待定值取最后一个，否则取 ready 的确认值，其余为 null */
  display: string | null
  /** 确认值可能已落后于磁盘（整代作废后在途写结果不明）；loader 见 stale 应重读 */
  stale: boolean
}

interface Pending {
  token: object
  content: string
}

interface Record_ {
  entry: NoteEntry
  pending: Pending[]
  stale: boolean
  /** 确认值（entry）每变化一次 +1 */
  version: number
}

export class NoteContentCache {
  private readonly records = new Map<string, Record_>()
  private readonly listeners = new Set<(file: string) => void>()

  private rec(file: string): Record_ {
    let r = this.records.get(file)
    if (!r) {
      r = { entry: { state: 'loading' }, pending: [], stale: false, version: 0 }
      this.records.set(file, r)
    }
    return r
  }

  private emit(file: string): void {
    for (const l of [...this.listeners]) l(file)
  }

  /** 当前正文：有待定值取最后一个待定值，否则取 ready 的确认值；其余 undefined */
  get(file: string): string | undefined {
    const r = this.records.get(file)
    if (!r) return undefined
    const last = r.pending[r.pending.length - 1]
    if (last) return last.content
    return r.entry.state === 'ready' ? r.entry.content : undefined
  }

  peek(file: string): NoteSnapshot | undefined {
    const r = this.records.get(file)
    if (!r) return undefined
    return { entry: r.entry, display: this.get(file) ?? null, stale: r.stale }
  }

  /** 确认值每次变化 +1；loader 发请求前记下，回来时不等则丢弃（防旧读结果盖掉新自写） */
  version(file: string): number {
    return this.records.get(file)?.version ?? 0
  }

  /** 开始加载。已有 ready 时不降级成 loading，只清 stale（重读中） */
  noteLoading(file: string): void {
    const existed = this.records.has(file)
    const r = this.rec(file)
    if (r.entry.state === 'ready') {
      if (r.stale) {
        r.stale = false
        this.emit(file)
      }
      return
    }
    const changed = r.entry.state !== 'loading' || r.stale
    r.entry = { state: 'loading' }
    r.stale = false
    if (changed || !existed) this.emit(file)
  }

  noteLoaded(file: string, content: string): void {
    this.setEntry(file, { state: 'ready', content })
  }

  noteMissing(file: string): void {
    this.setEntry(file, { state: 'missing' })
  }

  /**
   * 读失败。已有确认值时不降级（保留显示），只标 stale 待下次重读——不发通知，
   * 否则订阅的 loader 会对持续失败的服务端原地重读；其余状态记 error。
   */
  noteError(file: string, message: string): void {
    const r = this.records.get(file)
    if (r && r.entry.state === 'ready') {
      r.stale = true
      return
    }
    this.setEntry(file, { state: 'error', message })
  }

  private setEntry(file: string, entry: NoteEntry): void {
    const r = this.rec(file)
    const same = sameEntry(r.entry, entry)
    r.entry = entry
    r.stale = false
    if (!same) r.version++
    this.emit(file)
  }

  /** 登记一个待定值（提交 / 撤销 / 重做的同步段，乐观显示用） */
  setPending(file: string, content: string, token: object): void {
    this.rec(file).pending.push({ token, content })
    this.emit(file)
  }

  /** 落盘成功：确认值 = content，并去掉该 token 的待定值 */
  confirm(file: string, content: string, token?: object): void {
    const r = this.rec(file)
    if (token) r.pending = r.pending.filter((p) => p.token !== token)
    const next: NoteEntry = { state: 'ready', content }
    if (!sameEntry(r.entry, next)) r.version++
    r.entry = next
    r.stale = false
    this.emit(file)
  }

  /** 落盘失败：去掉该 token 在所有文件上的待定值 */
  dropPending(token: object): void {
    for (const [file, r] of this.records) {
      const n = r.pending.length
      if (n === 0) continue
      r.pending = r.pending.filter((p) => p.token !== token)
      if (r.pending.length !== n) this.emit(file)
    }
  }

  /** 丢掉全部待定值，返回涉及的文件并把它们标 stale（在途写可能已落盘也可能没有，交给 loader 重读） */
  dropAllPending(): string[] {
    const files: string[] = []
    for (const [file, r] of this.records) {
      if (r.pending.length === 0) continue
      r.pending = []
      r.stale = true
      files.push(file)
    }
    for (const f of files) this.emit(f)
    return files
  }

  markStale(file: string): void {
    const r = this.records.get(file)
    if (!r || r.stale) return
    r.stale = true
    this.emit(file)
  }

  /** 全部已登记的文件标 stale（重连 / 服务重启后的全量刷新：断线期间的外部改动没有事件，交 loader 重读对账） */
  markAllStale(): void {
    const files: string[] = []
    for (const [file, r] of this.records) {
      if (r.stale) continue
      r.stale = true
      files.push(file)
    }
    for (const f of files) this.emit(f)
  }

  forget(file: string): void {
    if (this.records.delete(file)) this.emit(file)
  }

  clear(): void {
    const files = [...this.records.keys()]
    this.records.clear()
    for (const f of files) this.emit(f)
  }

  subscribe(listener: (file: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

function sameEntry(a: NoteEntry, b: NoteEntry): boolean {
  if (a.state !== b.state) return false
  if (a.state === 'ready' && b.state === 'ready') return a.content === b.content
  if (a.state === 'error' && b.state === 'error') return a.message === b.message
  return true
}

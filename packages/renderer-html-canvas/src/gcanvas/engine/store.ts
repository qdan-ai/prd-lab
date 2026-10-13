/**
 * 文档 store —— 单一真相 + 订阅 + measured 旁路（设计依据：§1.1 / §1.8、契约 store.ts）
 *
 * 纪律：
 * - 不可变更新：每次变更产生新 CanvasDoc / elements 数组引用；未变元素保引用
 *   → React.memo 浅比较即可跳过未变元素的重渲染。
 * - **不暴露裸 set**：编辑变更只能经 session.commit（命令系统），架构纪律 API 层焊死。
 *   仅两个例外：setMeasured（与用户编辑数据分离的旁路）、replaceDoc（磁盘真相整体替换）。
 * - measured 旁路：不走命令、不入 undo、本 sprint 不落盘；同尺寸 no-op，同帧多块 rAF 批量合并通知。
 *
 * 调度器降级：rAF 仅浏览器有；node 单测环境用注入的 scheduler 或 queueMicrotask 降级，
 * 保证单测可控。createDocStore 的第二参为可选注入点（不破坏契约的单参调用形态）。
 */

import type { CanvasDoc, MeasuredSize } from './schema'

export interface DocStore {
  getDoc(): CanvasDoc
  subscribe(listener: () => void): () => void
  /**
   * measured 旁路：非编辑数据，不走命令、不入 undo 栈、本 sprint 不落盘（§1.8）。
   * 返回是否产生实质变更（true=尺寸有变、已更新 doc + 排程通知；false=未知 id / 无 measured
   * 字段类型 / 同尺寸 no-op）——调用方据此决定是否调度落盘，避免同尺寸测量空标脏。
   */
  setMeasured(id: string, size: MeasuredSize): boolean
  /** 以磁盘真相整体替换（热同步/落盘失败重载共用入口；调用方负责截断 undo 栈） */
  replaceDoc(doc: CanvasDoc): void
}

/** 批量调度器：收一个回调，择机（下一帧/微任务）执行一次。用于 measured 同帧合并通知 */
export type Scheduler = (cb: () => void) => void

/** 默认调度器：浏览器用 rAF，node/无 rAF 环境降级 queueMicrotask（单测可注入覆盖） */
function defaultScheduler(): Scheduler {
  if (typeof requestAnimationFrame === 'function') {
    return (cb) => {
      requestAnimationFrame(cb)
    }
  }
  return (cb) => {
    queueMicrotask(cb)
  }
}

export function createDocStore(initial: CanvasDoc, scheduler: Scheduler = defaultScheduler()): DocStore {
  let doc = initial
  const listeners = new Set<() => void>()

  // measured 批量：本帧已有待 flush 的 measured 更新时不重复排程，合并为一次通知
  let measuredPending = false

  function notify(): void {
    // 复制一份再遍历，容忍监听器在回调内退订
    for (const l of [...listeners]) l()
  }

  function scheduleMeasuredNotify(): void {
    if (measuredPending) return
    measuredPending = true
    scheduler(() => {
      measuredPending = false
      notify()
    })
  }

  return {
    getDoc() {
      return doc
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    setMeasured(id, size) {
      const idx = doc.elements.findIndex((el) => el.id === id)
      if (idx < 0) return false // 未知 id → 忽略，未变更
      const el = doc.elements[idx]!
      // 仅 html / text / note 元素带 measured 字段（schema）；其余类型忽略
      if (el.type !== 'html' && el.type !== 'text' && el.type !== 'note') return false
      const cur = el.measured
      // 同尺寸 no-op：不产生新引用、不通知（§1.8 工程优化①）；返回未变更供调用方免标脏
      if (cur && cur.w === size.w && cur.h === size.h) return false
      const nextEl = { ...el, measured: { w: size.w, h: size.h } }
      const elements = doc.elements.slice()
      elements[idx] = nextEl
      doc = { ...doc, elements }
      // 同帧多块实测合并为一次通知（§1.8 工程优化②）：doc 已即时更新，仅延迟通知
      scheduleMeasuredNotify()
      return true // 实质变更
    },

    replaceDoc(next) {
      doc = next
      // 磁盘真相替换是即时语义，同步通知（不与 measured 批量混用）
      notify()
    },
  }
}

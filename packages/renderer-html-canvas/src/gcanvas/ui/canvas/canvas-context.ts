/**
 * CanvasContext 垫片（PRD-Lab 自有）—— 顶替 G-canvas 的 ui/canvas/canvas-context.ts
 *
 * 逐字复制的渲染器（renderers/*View.tsx）经 `../canvas-context` 取渲染上下文。上游版本把
 * adapter 定为完整的 PersistenceAdapter（读写画板、AI 会话等），查看器只读、只需取文件：
 * 这里给出结构兼容的最小面，渲染器读到的字段一个不少。
 *
 * - adapter：loadBlock / loadStyle / assetUrl，按画板文件 URL 前缀（dataBaseUrl）取 blocks/、styles/、assets/；
 *   实现与类型都在 api.ts createCanvasAdapter（新增取文件方法只改那一处）
 * - boardId：渲染器透传给 adapter；查看器一次只看一块画板，值仅作标识
 * - zoom：FrameView 标题字号反向补偿
 * - setMeasured：html / text 首渲实测尺寸写回内存 store（查看器不落盘）
 * - resourceEpoch：查看器无热同步，恒为 0
 * - blockCache / blockResourceReady：上游编辑侧的撤销快照与注入握手，查看器不提供
 *
 * 上游 canvas-context.ts 变动时 gcanvas-sync check 会报红：对照新增字段补到这里。
 */
import { createContext, useContext } from 'react'
import type { MeasuredSize } from '../../engine/schema'
import type { createCanvasAdapter } from '../../../api'

/**
 * 查看器取画板文件的 adapter：类型即 api.ts createCanvasAdapter 的返回值（上游 PersistenceAdapter 中
 * 渲染器用到的那几项）。渲染器新增取文件方法时只改 createCanvasAdapter 一处。
 */
export type CanvasAdapter = ReturnType<typeof createCanvasAdapter>

export interface CanvasContextValue {
  adapter: CanvasAdapter
  boardId: string
  zoom: number
  setMeasured: (id: string, size: MeasuredSize) => void
  blockCache?: { note(file: string, raw: string): void }
  resourceEpoch: number
  blockResourceReady?: {
    publishReady(key: BlockResourceKey, generation: number): void
    publishError(key: BlockResourceKey, generation: number, err: unknown): void
    publishUnmounted(key: BlockResourceKey, generation: number): void
  }
}

interface BlockResourceKey {
  boardId: string
  hostElementId: string
  file: string
}

const CanvasContext = createContext<CanvasContextValue | null>(null)

export const CanvasContextProvider = CanvasContext.Provider

/** 取渲染上下文；未在 Provider 内使用即编程错误，直接抛 */
export function useCanvasContext(): CanvasContextValue {
  const ctx = useContext(CanvasContext)
  if (!ctx) {
    throw new Error('useCanvasContext 必须在 CanvasContextProvider 内使用')
  }
  return ctx
}

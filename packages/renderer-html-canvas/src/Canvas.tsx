/**
 * Canvas —— 无限画布（只读），按 G-canvas Stage 的方式组装：
 *
 *   div.hc-stage（视口：平移缩放手势、裁剪）
 *     └ div.hc-world（唯一承接 camera transform：translate(tx,ty) scale(zoom)，origin 0 0）
 *         └ ElementLayer（数组序 = 图层序）
 *
 * 文档放进 G-canvas 的内存 store（逐字件 engine/store.ts）：html / text 首渲实测尺寸经
 * setMeasured 写回（同尺寸 no-op、同帧合并通知），绑定到 HTML 块的箭头在块渲染出真实尺寸后
 * 按上游同一逻辑重算贴边。查看器只读，measured 只在内存，不落盘。
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { createDocStore } from './gcanvas/engine/store'
import { NoteContentCache } from './gcanvas/engine/note-content-cache'
import { createNoteLoader } from './gcanvas/ui/canvas/note/note-loader'
import type { MeasuredSize } from './gcanvas/engine/schema'
import { CanvasContextProvider, type CanvasContextValue } from './gcanvas/ui/canvas/canvas-context'
import { ElementLayer } from './gcanvas/ui/canvas/ElementLayer'
import { createCanvasAdapter } from './api'
import { collectViewerBounds, renderedDoc } from './known-elements'
import { useCamera } from './use-camera'
import type { BoardData } from './types'

type Props = {
  board: BoardData
  /** 画板文件 URL 前缀（结尾带斜杠） */
  baseUrl: string
  /** 画板标识，透传给渲染器（仅作标识） */
  boardId: string
}

export function Canvas({ board, baseUrl, boardId }: Props) {
  const store = useMemo(() => createDocStore(board), [board])
  const doc = useSyncExternalStore(store.subscribe, store.getDoc)

  // 逐字件只接收 schema 内的类型；未接入类型由 ElementLayer 渲染占位卡、由 collectViewerBounds 计入框选
  const knownDoc = useMemo(() => renderedDoc(doc), [doc])
  const bounds = useMemo(() => collectViewerBounds(doc), [doc])
  const {
    camera,
    spaceDown,
    panning,
    viewportRef,
    onPanPointerDown,
    onPanPointerMove,
    onPanPointerUp,
  } = useCamera(bounds)

  const setMeasured = useCallback(
    (id: string, size: MeasuredSize) => {
      store.setMeasured(id, size)
    },
    [store],
  )
  const adapter = useMemo(() => createCanvasAdapter(baseUrl), [baseUrl])
  // 标注正文：每块画板一份缓存 + 加载器（同一路径只请求一次）。缓存与加载器只被本画板持有、无定时器，
  // 随组件回收；不在 effect 清理里 dispose——StrictMode 开发期的模拟卸载会让复用的加载器永久停摆
  const noteContent = useMemo(() => {
    const cache = new NoteContentCache()
    return { cache, loader: createNoteLoader({ adapter, boardId, cache }) }
  }, [adapter, boardId])
  const ctx = useMemo<CanvasContextValue>(
    () => ({ adapter, boardId, zoom: camera.zoom, setMeasured, resourceEpoch: 0, noteContent }),
    [adapter, boardId, camera.zoom, setMeasured, noteContent],
  )

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : 'default'

  return (
    <CanvasContextProvider value={ctx}>
      <div
        ref={viewportRef}
        className="hc-stage"
        style={{ cursor }}
        onPointerDown={onPanPointerDown}
        onPointerMove={onPanPointerMove}
        onPointerUp={onPanPointerUp}
        onPointerCancel={onPanPointerUp}
      >
        <div
          className="hc-world"
          style={{
            transform: `translate(${camera.tx}px, ${camera.ty}px) scale(${camera.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <ElementLayer elements={doc.elements} doc={knownDoc} />
        </div>
      </div>
    </CanvasContextProvider>
  )
}

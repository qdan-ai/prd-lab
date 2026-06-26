/**
 * useCamera —— 相机状态 + 导航手势（只读渲染简化版）
 *
 * 从 html_canvas 的 use-camera.ts 简化而来，保留完整导航交互：
 * - 滚轮缩放（Cmd+滚轮 zoom、裸滚平移）
 * - 空格拖拽平移
 * - 键盘快捷键（Cmd+0 fitAll、Cmd+= 放大、Cmd+- 缩小）
 *
 * 去掉的部分：
 * - editingMode 门控（只读渲染无编辑态）
 * - active 标签切换逻辑（单画板场景）
 * - focusOn 聚焦单元素（只读渲染不需要）
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Camera, panBy, zoomAt, fitToContent, type Rect } from './camera'

const STEP_ZOOM_IN = 1.2
const STEP_ZOOM_OUT = 1 / 1.2
const INITIAL_CAMERA: Camera = { tx: 0, ty: 0, zoom: 1 }

export interface UseCameraResult {
  camera: Camera
  setCamera: React.Dispatch<React.SetStateAction<Camera>>
  /** 空格按住态（按住期间拖 = 平移） */
  spaceDown: boolean
  /** 平移拖动中（grabbing 光标） */
  panning: boolean
  /** Cmd+0：看全局 */
  doFit: () => void
  /** 视口本地坐标换算用：返回 viewport 的 client 矩形（left/top/宽高） */
  viewportRef: React.RefObject<HTMLDivElement | null>
  /** 空格拖平移的 pointer 处理 */
  onPanPointerDown: (ev: React.PointerEvent) => void
  onPanPointerMove: (ev: React.PointerEvent) => void
  onPanPointerUp: (ev: React.PointerEvent) => void
}

/** 视口本地坐标：client − viewportRect.left/top */
export function clientToViewport(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = viewportRef.current?.getBoundingClientRect()
  return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
}

export function useCamera(bounds: Rect[]): UseCameraResult {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  // 首屏 fit 门控：只 fit 一次
  const hasBeenFitRef = useRef(false)
  // bounds 经 ref 旁路：doFit 读最新值
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds

  const getViewport = () => {
    const vp = viewportRef.current
    return { w: vp?.clientWidth ?? 0, h: vp?.clientHeight ?? 0 }
  }

  const doFit = useCallback(() => {
    setCamera(fitToContent(boundsRef.current, getViewport()))
  }, [])

  // 首屏自动 fit：容器尺寸就绪后 fit 一次
  useLayoutEffect(() => {
    if (hasBeenFitRef.current) return
    const { w, h } = getViewport()
    if (w <= 0 || h <= 0) return
    hasBeenFitRef.current = true
    doFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // wheel：passive:false 才能 preventDefault（裸滚平移 / Cmd+滚缩放）
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const rect = vp.getBoundingClientRect()
      if (ev.ctrlKey || ev.metaKey) {
        const anchor = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
        const factor = Math.exp(-ev.deltaY * 0.01)
        setCamera((c) => zoomAt(c, anchor, factor))
      } else {
        setCamera((c) => panBy(c, -ev.deltaX, -ev.deltaY))
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  // 键盘：空格按住态 + Cmd+0 / Cmd+= / Cmd+-
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' && !ev.repeat) {
        setSpaceDown(true)
        ev.preventDefault()
        return
      }
      if (ev.metaKey || ev.ctrlKey) {
        if (ev.key === '0') {
          ev.preventDefault()
          doFit()
        } else if (ev.key === '=' || ev.key === '+') {
          ev.preventDefault()
          stepZoom(STEP_ZOOM_IN)
        } else if (ev.key === '-') {
          ev.preventDefault()
          stepZoom(STEP_ZOOM_OUT)
        }
      }
    }
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') setSpaceDown(false)
    }
    const stepZoom = (factor: number) => {
      const vp = getViewport()
      const anchor = { x: vp.w / 2, y: vp.h / 2 }
      setCamera((c) => zoomAt(c, anchor, factor))
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [doFit])

  // 空格 + 拖：pointer 平移
  const dragLast = useRef<{ x: number; y: number } | null>(null)
  const onPanPointerDown = (ev: React.PointerEvent) => {
    if (!spaceDown) return
    dragLast.current = { x: ev.clientX, y: ev.clientY }
    setPanning(true)
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
  }
  const onPanPointerMove = (ev: React.PointerEvent) => {
    if (!panning || !dragLast.current) return
    const dx = ev.clientX - dragLast.current.x
    const dy = ev.clientY - dragLast.current.y
    dragLast.current = { x: ev.clientX, y: ev.clientY }
    setCamera((c) => panBy(c, dx, dy))
  }
  const onPanPointerUp = (ev: React.PointerEvent) => {
    if (!panning) return
    dragLast.current = null
    setPanning(false)
    ;(ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId)
  }

  return {
    camera,
    setCamera,
    spaceDown,
    panning,
    doFit,
    viewportRef,
    onPanPointerDown,
    onPanPointerMove,
    onPanPointerUp,
  }
}

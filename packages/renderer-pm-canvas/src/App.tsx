import { useCallback, useEffect, useRef, useState } from "react";
import type { RendererConfig } from "./types";
import { CanvasFrame, scrollIframeToRow } from "./CanvasFrame";
import { DocsPanel } from "./DocsPanel";
import { AnchorsList } from "./Anchors/AnchorsList";
import { fetchAnchorsOptional } from "./api";
import type { AnchorsFile } from "./types";

const RIGHT_PANEL_DEFAULT_W = 420;
const RIGHT_PANEL_MIN_W = 320;
const RIGHT_PANEL_MAX_RATIO = 0.7;

type Props = {
  config: RendererConfig;
};

/**
 * SPA 顶层组件：左右分栏壳 + 状态管理。
 *
 * 布局：
 *   ┌────────────────────────┬─────────────┐
 *   │  CanvasFrame (iframe)  │  Anchors    │
 *   │                        │  DocsPanel  │
 *   └────────────────────────┴─────────────┘
 *
 * 状态：
 *   - anchors：异步 fetch docs/anchors.json（仅当 __computed.hasAnchors === true）
 *   - iframe ref：透传给 AnchorsList 用于触发 scrollIntoView
 */
export function App(props: Props) {
  const { config } = props;
  const docs = config.rendererMetadata.__computed.docs;
  const hasAnchors = config.rendererMetadata.__computed.hasAnchors;
  const [anchors, setAnchors] = useState<AnchorsFile | null>(null);
  const [rightWidth, setRightWidth] = useState<number>(RIGHT_PANEL_DEFAULT_W);
  const canvasFrameWrapperRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAnchorsOptional(config.dataBaseUrl, hasAnchors).then((a) => {
      if (!cancelled) setAnchors(a);
    });
    return () => {
      cancelled = true;
    };
  }, [config.dataBaseUrl, hasAnchors]);

  const handleJumpRow = useCallback((rowId: string) => {
    const iframe = canvasFrameWrapperRef.current?.querySelector("iframe");
    scrollIframeToRow(iframe ?? null, rowId);
  }, []);

  // 右栏拖拽：全屏 overlay 防止 iframe 抢 mousemove；上下限对齐 pm-canvas-viewer
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const main = mainRef.current;
    if (!main) return;

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;cursor:col-resize";
    document.body.appendChild(overlay);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const handleMove = (ev: MouseEvent) => {
      const rect = main.getBoundingClientRect();
      const next = rect.right - ev.clientX;
      const maxW = Math.floor(rect.width * RIGHT_PANEL_MAX_RATIO);
      setRightWidth(Math.max(RIGHT_PANEL_MIN_W, Math.min(maxW, next)));
    };
    const handleUp = () => {
      overlay.remove();
      document.body.style.userSelect = prevUserSelect;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

  return (
    <div className="pm-canvas-app">
      <header className="pm-canvas-header">
        <span className="pm-canvas-header-title">PM Canvas</span>
        <span className="pm-canvas-header-meta">snapshot {config.snapshotId.slice(0, 8)}</span>
      </header>
      <main className="pm-canvas-main" ref={mainRef}>
        <div className="pm-canvas-left" ref={canvasFrameWrapperRef}>
          <CanvasFrame baseUrl={config.dataBaseUrl} entryHtmlPath={config.entryHtmlPath} />
        </div>
        <aside className="pm-canvas-right" style={{ width: `${rightWidth}px` }}>
          <div
            className="pm-canvas-resize-handle"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整右侧面板宽度"
          />
          <AnchorsList anchors={anchors} onJumpRow={handleJumpRow} />
          <DocsPanel baseUrl={config.dataBaseUrl} docs={docs} />
        </aside>
      </main>
    </div>
  );
}

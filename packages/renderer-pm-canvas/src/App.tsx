import { useCallback, useEffect, useRef, useState } from "react";
import type { RendererConfig } from "./types";
import { CanvasFrame, scrollIframeToRow } from "./CanvasFrame";
import { DocsPanel } from "./DocsPanel";
import { AnchorsList } from "./Anchors/AnchorsList";
import { fetchAnchorsOptional } from "./api";
import type { AnchorsFile } from "./types";

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
  const canvasFrameWrapperRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="pm-canvas-app">
      <header className="pm-canvas-header">
        <span className="pm-canvas-header-title">PM Canvas</span>
        <span className="pm-canvas-header-meta">snapshot {config.snapshotId.slice(0, 8)}</span>
      </header>
      <main className="pm-canvas-main">
        <div className="pm-canvas-left" ref={canvasFrameWrapperRef}>
          <CanvasFrame baseUrl={config.dataBaseUrl} entryHtmlPath={config.entryHtmlPath} />
        </div>
        <aside className="pm-canvas-right">
          <AnchorsList anchors={anchors} onJumpRow={handleJumpRow} />
          <DocsPanel baseUrl={config.dataBaseUrl} docs={docs} />
        </aside>
      </main>
    </div>
  );
}

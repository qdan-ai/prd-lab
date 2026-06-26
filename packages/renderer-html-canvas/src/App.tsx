/**
 * App —— SPA 顶层组件：布局 + 数据加载
 *
 * 布局：左画布 + 右 docs 面板（仅当画板携带 docs 时显示）。
 *   ┌────────────────────────┬─────────────┐
 *   │  Canvas（无限画布）     │  DocsPanel  │
 *   └────────────────────────┴─────────────┘
 *
 * 数据流：fetch canvas.json → 解析为 BoardData → 交 Canvas 渲染六元素。
 */
import { useEffect, useState } from "react";
import type { RendererConfig, BoardData } from "./types";
import { Canvas } from "./Canvas";
import { DocsPanel } from "./DocsPanel";
import { fetchJson, FetchError } from "./api";

type Props = {
  config: RendererConfig;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; board: BoardData }
  | { status: "error"; message: string };

export function App({ config }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const docs = config.rendererMetadata.__computed.docs;
  const elementCount = config.rendererMetadata.__computed.elementCount;

  useEffect(() => {
    let cancelled = false;
    fetchJson<BoardData>(config.dataBaseUrl, "canvas.json")
      .then((board) => {
        if (cancelled) return;
        setState({ status: "ready", board });
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof FetchError
            ? `加载 canvas.json 失败（${err.status}）`
            : err instanceof Error
              ? err.message
              : String(err);
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [config.dataBaseUrl]);

  return (
    <div className="hc-app">
      <header className="hc-header">
        <span className="hc-header-title">HTML Canvas</span>
        <span className="hc-header-meta">snapshot {config.snapshotId.slice(0, 8)}</span>
        <span className="hc-header-meta">{elementCount} elements</span>
      </header>
      <main className="hc-main">
        <div className="hc-canvas-wrap">
          {state.status === "loading" && (
            <div className="hc-canvas-status">加载画板（{elementCount} elements）…</div>
          )}
          {state.status === "error" && (
            <div className="hc-canvas-status is-error">
              加载画板失败：{state.message}
            </div>
          )}
          {state.status === "ready" && (
            <Canvas board={state.board} baseUrl={config.dataBaseUrl} />
          )}
        </div>
        {docs.length > 0 && (
          <aside className="hc-right">
            <DocsPanel baseUrl={config.dataBaseUrl} docs={docs} />
          </aside>
        )}
      </main>
    </div>
  );
}

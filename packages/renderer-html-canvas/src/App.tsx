/**
 * App —— SPA 顶层组件：布局 + 数据加载
 *
 * 布局：左画布 + 右 docs 面板（仅当画板携带 docs 时显示）。
 *   ┌────────────────────────┬─────────────┐
 *   │  Canvas（无限画布）     │  DocsPanel  │
 *   └────────────────────────┴─────────────┘
 *
 * 数据流：fetch canvas.json → 旧格式兼容转换（legacy-board）→ G-canvas validateCanvasDoc 诊断（只告警不拦截）
 *   → 等画布字体就绪（canvas-fonts，与取 canvas.json 并行，最多 3 秒）→ 交 Canvas 渲染。
 */
import { useEffect, useState } from "react";
import type { RendererConfig, BoardData } from "./types";
import { Canvas } from "./Canvas";
import { DocsPanel } from "./DocsPanel";
import { fetchJson, FetchError } from "./api";
import { validateCanvasDoc } from "./gcanvas/engine/schema";
import { migrateLegacyBoard } from "./legacy-board";
import { waitForCanvasFonts } from "./canvas-fonts";

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
    // 与取 canvas.json 并行等字体：画布须在字体就绪后挂载，文本首渲量到的才是真实宽度
    const fontsReady = waitForCanvasFonts();
    fetchJson<BoardData>(config.dataBaseUrl, "canvas.json")
      .then(async (raw) => {
        if (cancelled) return;
        if (!Array.isArray(raw?.elements)) {
          setState({ status: "error", message: "canvas.json 缺少 elements 数组" });
          return;
        }
        const board = migrateLegacyBoard(raw);
        // 校验不通过照常渲染：画板可能来自更新的 G-canvas（含查看器尚未接入的字段 / 元素类型）
        const diagnosis = validateCanvasDoc(board);
        if (!diagnosis.ok) {
          console.warn("[html-canvas] canvas.json 未通过 G-canvas 校验（仍按能识别的部分渲染）：\n" + diagnosis.errors.join("\n"));
        }
        await fontsReady;
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
            <Canvas board={state.board} baseUrl={config.dataBaseUrl} boardId={config.snapshotId} />
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

import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { fetchText, FetchError } from "../api";

type Props = {
  baseUrl: string;
  docPath: string;
};

type ExcalidrawSceneJson = {
  type?: string;
  version?: number;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

/**
 * Excalidraw 只读 viewer（DESIGN §7.4）：
 * - 用 @excalidraw/excalidraw 同库 + viewModeEnabled
 * - 数据是 PM 上传的 .excalidraw JSON 文件
 * - 不暴露任何编辑工具栏
 */
export function ExcalidrawViewer(props: Props) {
  const { baseUrl, docPath } = props;
  const [scene, setScene] = useState<ExcalidrawSceneJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setError(null);
    fetchText(baseUrl, docPath)
      .then((text) => {
        if (cancelled) return;
        try {
          setScene(JSON.parse(text) as ExcalidrawSceneJson);
        } catch (e) {
          setError(`解析失败：${(e as Error).message}`);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof FetchError) setError(`加载失败：${e.message}`);
        else setError(`加载失败：${(e as Error).message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, docPath]);

  if (error) return <div className="pm-canvas-doc-error">{error}</div>;
  if (scene === null) return <div className="pm-canvas-doc-loading">加载中…</div>;

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 400 }}>
      <Excalidraw
        initialData={{
          elements: (scene.elements ?? []) as never,
          appState: { ...(scene.appState ?? {}), viewBackgroundColor: "#ffffff" } as never,
          files: (scene.files ?? {}) as never,
        }}
        viewModeEnabled
        zenModeEnabled
        gridModeEnabled={false}
        UIOptions={{
          canvasActions: {
            saveToActiveFile: false,
            loadScene: false,
            export: false,
            saveAsImage: false,
            changeViewBackgroundColor: false,
            clearCanvas: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}

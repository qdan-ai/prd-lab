import { useEffect, useRef } from "react";

type Props = {
  baseUrl: string;
  entryHtmlPath: string;
  onRowScrollRequest?: (rowId: string) => void;
};

/**
 * 左侧画板 iframe（DESIGN §7.3.4 / D7）：
 * - src 走 `?raw=1`，预览站据此绕过 SPA 分支返回画板原文（DESIGN §6.1）
 * - 与 SPA 同 origin（都在 preview.local 下），可通过 iframe.contentDocument 直接互访
 * - 暴露 imperative API `scrollToRow` 给父组件，触发画板内 row-XX 元素 scrollIntoView（D10 v1 不做实时 overlay）
 *
 * 安全防御（§9）：
 * - 所有从画板 contentDocument 取出的文本不通过 innerHTML 注入 SPA
 * - 任何 addEventListener('message') 必须校验 event.origin === location.origin 且 event.source 匹配本 iframe
 */
export function CanvasFrame(props: Props) {
  const { baseUrl, entryHtmlPath } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 暴露 scrollToRow 给父：通过 iframe.contentDocument 找 row-XX 元素并 scrollIntoView
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // 当前 SPA 不主动监听 iframe 的 postMessage（画板未发），但留校验骨架
      if (event.origin !== location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      // 未来扩展点：画板若发 message，在此分发
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const src = baseUrl + entryHtmlPath + (entryHtmlPath.includes("?") ? "&raw=1" : "?raw=1");

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title="PM Canvas Board"
      style={{ width: "100%", height: "100%", border: 0, background: "#fafafa" }}
      // sandbox 不能加：画板自带 inline script 与 panzoom 库需运行
    />
  );
}

/**
 * 通过 iframe 触发画板内某 row 的 scrollIntoView。
 * 由父组件（Anchors）持有 iframe ref 后调用此函数。
 */
export function scrollIframeToRow(iframe: HTMLIFrameElement | null, rowId: string): void {
  if (!iframe) return;
  const doc = iframe.contentDocument;
  if (!doc) return;
  // 画板 row 已规范化 ID 为 row-01..NN（参考 pm-canvas-viewer index.html:500）
  const target = doc.getElementById(rowId);
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

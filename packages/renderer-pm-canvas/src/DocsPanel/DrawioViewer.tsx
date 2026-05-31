import { useEffect, useState } from "react";
import pako from "pako";
import { fetchText, FetchError } from "../api";

type Props = {
  baseUrl: string;
  docPath: string;
};

/**
 * drawio 只读 viewer（DESIGN §7.4 / 决策 D22 覆盖 D4）：
 *
 *   embed 形态 = viewer.diagrams.net lightbox + URL hash
 *
 * 数据流：
 *   1. fetch .drawio 原文（mxfile XML 或 mxGraphModel XML）
 *   2. UTF-8 → deflate-raw → base64 → encodeURIComponent → iframe src #R{encoded}
 *   3. drawio 标准 "R" 前缀表示 hash 内容已压缩 + base64；viewer 自己解码渲染
 *
 * 安全模型（明确接受）：
 *   - hash 通过浏览器规范保证不发服务器 → XML 内容不上行 jgraph
 *   - iframe 资源加载本身仍向 viewer.diagrams.net 发请求 → "PM 在某时刻打开过一份图"的访问元数据外送
 *   - 预览站 CSP frame-src 必须严格放行 `https://viewer.diagrams.net`，不给 *.diagrams.net 通配
 *
 * 后续切回零外部依赖：见 DESIGN §7.4 原 v2 候选方案 1（@jgraph/drawio-tools 纯前端库）。
 */
export function DrawioViewer(props: Props) {
  const { baseUrl, docPath } = props;
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIframeSrc(null);
    setError(null);
    fetchText(baseUrl, docPath)
      .then((xml) => {
        if (cancelled) return;
        try {
          setIframeSrc(buildDrawioViewerUrl(xml));
        } catch (e) {
          setError(`编码失败：${(e as Error).message}`);
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
  if (iframeSrc === null) return <div className="pm-canvas-doc-loading">加载中…</div>;

  return (
    <iframe
      src={iframeSrc}
      title={`drawio: ${docPath}`}
      style={{ width: "100%", height: "100%", minHeight: 400, border: 0 }}
      // 防 referrer 泄漏 prd-lab URL 给 jgraph
      referrerPolicy="no-referrer"
      // 让 viewer 站脚本能跑，但不获得本 origin 同源能力
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
    />
  );
}

/**
 * 构建 viewer.diagrams.net lightbox URL。
 *
 * 输出形如：
 *   https://viewer.diagrams.net/?lightbox=1&edit=_blank&highlight=0000ff&nav=1#R{encoded}
 *
 * 其中 R 前缀 = drawio 协议约定的"hash payload 已 deflate + base64"。
 */
export function buildDrawioViewerUrl(xml: string): string {
  const utf8Bytes = new TextEncoder().encode(xml);
  const deflated = pako.deflateRaw(utf8Bytes);
  const binaryString = uint8ArrayToBinaryString(deflated);
  const base64 = btoa(binaryString);
  const encoded = encodeURIComponent(base64);
  return `https://viewer.diagrams.net/?lightbox=1&edit=_blank&highlight=0000ff&nav=1#R${encoded}`;
}

function uint8ArrayToBinaryString(arr: Uint8Array): string {
  // 分块以避免 String.fromCharCode 在大数组上栈溢出
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < arr.length; i += CHUNK) {
    const slice = arr.subarray(i, Math.min(i + CHUNK, arr.length));
    out += String.fromCharCode(...slice);
  }
  return out;
}

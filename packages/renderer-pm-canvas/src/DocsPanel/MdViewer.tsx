import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { fetchText, FetchError } from "../api";

type Props = {
  baseUrl: string;
  docPath: string;
};

/**
 * Markdown 只读 viewer：markdown-it 渲染 + DOMPurify 净化（DESIGN §7.4）。
 *
 * - 不支持任何编辑能力（与 BRIEF 红线一致）
 * - DOMPurify 默认 profile 已禁用 <script>、危险 attr handler；不再额外配置
 */
export function MdViewer(props: Props) {
  const { baseUrl, docPath } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const md = useMemo(
    () =>
      new MarkdownIt({
        html: false, // 不接受原始 HTML（PM 的 md 文档应为纯 markdown）
        linkify: true,
        breaks: false,
        typographer: false,
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    fetchText(baseUrl, docPath)
      .then((text) => {
        if (!cancelled) setSrc(text);
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
  if (src === null) return <div className="pm-canvas-doc-loading">加载中…</div>;

  const html = DOMPurify.sanitize(md.render(src));

  return (
    <div
      className="pm-canvas-md"
      // sanitize 后的 HTML 安全注入；不接受画板/外部数据走此路径
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

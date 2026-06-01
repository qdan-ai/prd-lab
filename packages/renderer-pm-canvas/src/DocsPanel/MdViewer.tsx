import { useEffect, useMemo, useState } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { fetchText, FetchError } from "../api";

type Props = {
  baseUrl: string;
  docPath: string;
};

/**
 * Markdown 只读 viewer：markdown-it 转 HTML → DOMPurify 净化 → Tiptap editable=false 渲染。
 *
 * - editable=false：renderer BRIEF 红线，PM 上传的 snapshot 是 immutable 不可改
 * - markdown-it 仍负责 markdown→HTML 桥（Tiptap 不原生读 markdown 字符串）
 * - DOMPurify 默认 profile 拦截 <script> / on* handler，setContent 收到的 HTML 安全
 */
export function MdViewer(props: Props) {
  const { baseUrl, docPath } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const md = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        breaks: false,
        typographer: false,
      }),
    [],
  );

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    editable: false,
    // React 19 SSR-safe；Vite SPA 实际不 SSR，但保留避免 hydration mismatch 警告
    immediatelyRender: false,
  });

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

  useEffect(() => {
    if (!editor || src === null) return;
    if (editor.isDestroyed) return;
    const html = DOMPurify.sanitize(md.render(src));
    editor.commands.setContent(html);
  }, [editor, src, md]);

  if (error) return <div className="pm-canvas-doc-error">{error}</div>;
  if (src === null || !editor) return <div className="pm-canvas-doc-loading">加载中…</div>;

  return <EditorContent editor={editor} className="pm-canvas-md" />;
}

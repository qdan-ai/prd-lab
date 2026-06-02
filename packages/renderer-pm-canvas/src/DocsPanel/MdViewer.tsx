import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { fetchText, FetchError } from "../api";

type Props = {
  baseUrl: string;
  docPath: string;
};

/**
 * Markdown 只读 viewer：@tiptap/markdown 直 parse → Tiptap editable=false 渲染。
 *
 * - 与 pm-canvas-viewer 的 MdEditor 扩展集对齐（StarterKit + Markdown + Table 系列），
 *   只是 editable=false 且去掉 anchor / toolbar / 保存逻辑。
 * - 不再走 markdown-it → HTML → DOMPurify 链路：Tiptap schema 本身是节点白名单，
 *   未定义节点（含 <script>）会被 DOMParser 兜底丢掉，安全性已由 schema 保证。
 */
export function MdViewer(props: Props) {
  const { baseUrl, docPath } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ markedOptions: { gfm: true } }),
      Table.configure({ HTMLAttributes: { class: "pm-canvas-md-table" } }),
      TableRow,
      TableCell,
      TableHeader,
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: "",
    editable: false,
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
    editor.commands.setContent(src, { contentType: "markdown" });
  }, [editor, src]);

  if (error) return <div className="pm-canvas-doc-error">{error}</div>;
  if (src === null || !editor) return <div className="pm-canvas-doc-loading">加载中…</div>;

  return <EditorContent editor={editor} className="pm-canvas-md" />;
}

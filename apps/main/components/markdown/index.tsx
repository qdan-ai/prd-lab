import { Fragment, type ReactNode } from "react";

/**
 * 极简 markdown 渲染：用于"改动说明"等用户短文本。
 *
 * 支持：
 * - 无序列表（行首 "- " 或 "* "）
 * - 有序列表（行首 "1. " "2. " 等）
 * - 行内 **粗体**、*斜体*、`代码`
 * - 段落（空行分隔；段内单换行用 <br />）
 *
 * 不支持：链接 / 图片 / 代码块 / 表格 / 标题（用户场景不需要）
 * 安全：所有文本通过 React children 渲染，自动 escape HTML，无 XSS 风险。
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  if (!text || !text.trim()) return null;
  const blocks = parseBlocks(text);
  return (
    <div className={className ?? "space-y-2 leading-[1.7]"}>
      {blocks.map((b, i) => {
        if (b.type === "ul") {
          return (
            <ul key={i} className="list-disc pl-5 space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; lines: string[] };

const UL = /^[-*]\s+(.+)$/;
const OL = /^\d+\.\s+(.+)$/;

function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trimStart();
    if (trimmed === "") {
      i++;
      continue;
    }
    const ulMatch = UL.exec(trimmed);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = UL.exec(lines[i]!.trimStart());
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const olMatch = OL.exec(trimmed);
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = OL.exec(lines[i]!.trimStart());
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const pLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i]!.trimStart();
      if (t === "" || UL.test(t) || OL.test(t)) break;
      pLines.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "p", lines: pLines });
  }
  return blocks;
}

/**
 * textarea 辅助：Enter 时若上一行是 "- " / "* " / "1. "，自动延续序号；
 * 若上一行是空列表项（仅前缀无内容），则取消列表。
 */
export function handleListContinuation(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  setValue: (next: string) => void,
) {
  if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  const ta = e.currentTarget;
  const { value, selectionStart, selectionEnd } = ta;
  if (selectionStart !== selectionEnd) return;
  const before = value.slice(0, selectionStart);
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = before.slice(lineStart);
  const ul = /^(\s*)([-*])\s+(.*)$/.exec(currentLine);
  const ol = /^(\s*)(\d+)\.\s+(.*)$/.exec(currentLine);
  if (!ul && !ol) return;
  const rest = ul ? ul[3]! : ol![3]!;
  if (rest.trim() === "") {
    // 空列表项 → 退出列表（删除整行）
    e.preventDefault();
    const next = value.slice(0, lineStart) + value.slice(selectionStart);
    setValue(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = lineStart;
    });
    return;
  }
  e.preventDefault();
  const prefix = ul
    ? `${ul[1]}${ul[2]} `
    : `${ol![1]}${Number(ol![2]) + 1}. `;
  const insert = `\n${prefix}`;
  const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
  setValue(next);
  const caret = selectionStart + insert.length;
  requestAnimationFrame(() => {
    ta.selectionStart = ta.selectionEnd = caret;
  });
}

// 行内：**bold** / *italic* / `code`，按出现顺序切片
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;

function renderInline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index!;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="px-1 py-0.5 bg-ink-100 rounded text-[0.9em] font-mono"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

"use client";

import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink, FileCode, FileImage, FileText, FileVideo, File } from "lucide-react";
import { apiFetch, filesApi, snapshotsApi, type SnapshotFileRow } from "@/lib/api-client";
import { Markdown } from "@/components/markdown";

interface Props {
  snapshotId: string;
  entryHtmlPath: string;
  changeNote: string;
}

/**
 * S9：版本页中央文件列表。
 *
 * - SWR 拉 GET /files
 * - 点 HTML 文件 → 调 POST /preview-token 拿短期 HMAC token → window.open 新窗口
 *   preview 站收 ?token=... → 设 cookie path=/p/{sid} → 302 去 query；后续子资源走 cookie
 * - 非 HTML 文件同样走 preview 路径（浏览器直接渲染或下载）
 */
export function SnapshotFileList({ snapshotId, entryHtmlPath, changeNote }: Props) {
  const { data, isLoading, error } = useSWR<{ files: SnapshotFileRow[] }>(
    snapshotId ? `/api/v1/snapshots/${snapshotId}/files` : null,
    () => filesApi.list(snapshotId),
    { dedupingInterval: 30_000 },
  );

  const onOpen = async (relPath: string) => {
    try {
      const { token } = await snapshotsApi.refreshPreviewToken(snapshotId);
      const encodedRel = relPath.split("/").map(encodeURIComponent).join("/");
      const url = `http://preview.local/p/${snapshotId}/${encodedRel}?token=${encodeURIComponent(token)}`;
      window.open(url, "_blank", "noopener");
    } catch {
      // toast 已自动
    }
  };

  if (error) {
    return (
      <EmptyState>
        <div className="text-[13px] text-ink-700">加载失败</div>
        <div className="text-[12px] text-ink-500 mt-1">请刷新页面重试</div>
      </EmptyState>
    );
  }

  if (isLoading || !data) {
    return (
      <EmptyState>
        <div className="text-[13px] text-ink-500">加载文件清单中…</div>
      </EmptyState>
    );
  }

  const files = data.files;
  if (files.length === 0) {
    return (
      <EmptyState>
        <div className="text-[13px] text-ink-700">该版本无文件</div>
      </EmptyState>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-ink-50/30" data-testid="snapshot-file-list">
      <div className="max-w-[860px] mx-auto px-6 py-6">
        <header className="mb-5">
          <div className="text-[13px] text-ink-700 font-medium">改动说明</div>
          <div className="text-[13px] text-ink-900 mt-1">
            {changeNote ? (
              <Markdown text={changeNote} className="space-y-2 leading-[1.6]" />
            ) : (
              <span className="text-ink-400">（未填写）</span>
            )}
          </div>
        </header>
        <div className="text-[12px] text-ink-500 mb-2">
          共 {files.length} 个文件 · 点击任意文件在新窗口打开预览
          {entryHtmlPath ? (
            <>
              {" · 入口 "}
              <code className="px-1 py-0.5 bg-ink-100 rounded text-[11px]">{entryHtmlPath}</code>
            </>
          ) : null}
        </div>
        <ul className="bg-white border border-ink-200 rounded-[var(--radius-lg)] overflow-hidden">
          {files.map((f) => {
            const isEntry = f.relPath === entryHtmlPath;
            return (
              <li key={f.relPath} className="border-b border-ink-150 last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpen(f.relPath)}
                  data-testid="snapshot-file-row"
                  data-rel-path={f.relPath}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-ink-50 transition-colors duration-[var(--duration-fast)] focus:outline-none focus:bg-ink-50"
                >
                  <span className="shrink-0 text-ink-500">{pickIcon(f.contentType)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-[13px] text-ink-900 font-mono break-all">
                      {f.relPath}
                    </span>
                    {isEntry ? (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 bg-ink-900 text-ink-50 text-[10px] rounded-[var(--radius-sm)] align-middle">
                        入口
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-500 tabular-nums">
                    {formatBytes(f.sizeBytes)}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-400 font-mono w-[112px] truncate">
                    {f.contentType}
                  </span>
                  <ExternalLink size={13} strokeWidth={2.25} className="shrink-0 text-ink-400" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-ink-50/30 text-center px-6">
      <div>{children}</div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function pickIcon(contentType: string) {
  if (contentType.startsWith("image/")) return <FileImage size={14} strokeWidth={2.25} />;
  if (contentType.startsWith("video/") || contentType.startsWith("audio/"))
    return <FileVideo size={14} strokeWidth={2.25} />;
  if (
    contentType.includes("html") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("css")
  )
    return <FileCode size={14} strokeWidth={2.25} />;
  if (contentType.startsWith("text/")) return <FileText size={14} strokeWidth={2.25} />;
  return <File size={14} strokeWidth={2.25} />;
}

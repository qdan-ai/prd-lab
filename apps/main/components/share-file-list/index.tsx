"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileCode, FileImage, FileText, FileVideo, File } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

interface Props {
  shareId: string;
  snapshotId: string;
  entryHtmlPath: string;
}

type FileRow = {
  relPath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

/**
 * S9：访客侧文件列表。
 *
 * - 拉 GET /share/[shareId]/api/files 取文件清单
 * - 点击 → POST /share/[shareId]/api/preview-token 签短期 token → window.open
 */
export function ShareFileList({ shareId, snapshotId, entryHtmlPath }: Props) {
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ files: FileRow[] }>(`/share/${shareId}/api/files`, undefined, { silent: true })
      .then((data) => {
        if (!cancelled) setFiles(data.files);
      })
      .catch(() => {
        if (!cancelled) setError("文件清单加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const onOpen = async (relPath: string) => {
    try {
      const { token } = await apiFetch<{ token: string; expiresIn: number }>(
        `/share/${shareId}/api/preview-token`,
        { method: "POST", body: JSON.stringify({ snapshotId }) },
      );
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
        <div className="text-[13px] text-ink-700">{error}</div>
      </EmptyState>
    );
  }
  if (!files) {
    return (
      <EmptyState>
        <div className="text-[13px] text-ink-500">加载中…</div>
      </EmptyState>
    );
  }
  if (files.length === 0) {
    return (
      <EmptyState>
        <div className="text-[13px] text-ink-700">该版本无文件</div>
      </EmptyState>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-ink-50/30" data-testid="share-file-list">
      <div className="max-w-[860px] mx-auto px-6 py-6">
        <div className="text-[12px] text-ink-500 mb-2">
          共 {files.length} 个文件 · 点击在新窗口打开
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
                  data-testid="share-file-row"
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

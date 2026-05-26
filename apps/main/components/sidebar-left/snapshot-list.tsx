"use client";

import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { apiFetch, snapshotsApi, type SnapshotRow } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { RenameChangeNoteModal } from "@/components/rename-change-note-modal";
import { RenameDialog } from "@/components/rename-dialog";
import { DeleteSnapshotModal } from "@/components/delete-snapshot-modal";
import { ShareDialog } from "@/components/share-dialog";

interface Props {
  versionId: string;
  ownedByMe?: boolean;
}

/**
 * 全部版本列表（S8 改造）：
 * - snapshot 平行化：删 "当前"/"草稿"/"预览态" chip + "设为当前" 菜单
 * - 加 "分享" 菜单（owner-only）
 * - 主标签：versionLabel ?? v{seq}
 * - 选中态：URL `?snapshot=v{seq}` 或无 query 时高亮最新（seq 最大）
 */
export function SnapshotList({ versionId, ownedByMe = true }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewingSeqRaw = searchParams.get("snapshot");
  const viewingSeqMatch = viewingSeqRaw ? /^v(\d+)$/.exec(viewingSeqRaw) : null;
  const viewingSeq = viewingSeqMatch ? Number(viewingSeqMatch[1]) : null;

  const { data, error, isLoading } = useSWR<SnapshotRow[]>(
    `/api/v1/versions/${versionId}/snapshots`,
    (url: string) => apiFetch<SnapshotRow[]>(url),
    { keepPreviousData: true, dedupingInterval: 30_000 },
  );

  const [renameTarget, setRenameTarget] = useState<SnapshotRow | null>(null);
  const [renameLabelTarget, setRenameLabelTarget] = useState<SnapshotRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SnapshotRow | null>(null);
  const [shareTarget, setShareTarget] = useState<SnapshotRow | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-1.5" data-testid="snapshot-list-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[68px] rounded-[var(--radius-md)] bg-ink-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 select-none">
        <div className="text-[13px] text-danger font-medium mb-1.5">无法加载版本列表</div>
      </div>
    );
  }

  const list = data ?? [];

  if (list.length === 0) {
    return (
      <div className="text-center py-10 select-none" data-testid="snapshot-list-empty">
        <div className="text-[13px] text-ink-700 font-medium mb-1.5">还没有版本</div>
        <div className="text-[12px] text-ink-500 leading-relaxed px-4">
          {ownedByMe ? (
            <>
              点底部 <span className="font-medium text-ink-700">+ 上传新版本</span> 开始
            </>
          ) : (
            <>项目所有者尚未上传版本</>
          )}
        </div>
      </div>
    );
  }

  const onClickRow = (seq: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("snapshot", `v${seq}`);
    router.push(`${url.pathname}${url.search}`, { scroll: false });
  };

  // 无 query 时默认高亮最新（seq 最大，即 list[0]，因后端 DESC）
  const latestSeq = list[0]!.seqNo;

  return (
    <>
      <ul className="space-y-1" data-testid="snapshot-list" role="list">
        {list.map((s) => {
          const isViewing = viewingSeq === s.seqNo || (viewingSeq === null && s.seqNo === latestSeq);
          return (
            <li key={s.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onClickRow(s.seqNo)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClickRow(s.seqNo);
                  }
                }}
                data-testid={`snapshot-row-v${s.seqNo}`}
                className={cn(
                  "group relative px-2.5 py-2 rounded-[var(--radius-md)] cursor-pointer transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1",
                  isViewing ? "bg-ink-100 hover:bg-ink-150" : "hover:bg-ink-50",
                )}
              >
                <div className="flex items-center gap-1.5 text-[12px] mb-0.5">
                  <span
                    className="inline-flex items-center justify-center w-2.5 h-2.5 rounded-full shrink-0 border border-ink-400 bg-white"
                    aria-hidden
                  />
                  <span className="font-semibold text-ink-900 tabular-nums">
                    {s.versionLabel ?? `v${s.seqNo}`}
                  </span>
                  {s.versionLabel ? (
                    <span className="text-[10px] text-ink-500 tabular-nums">v{s.seqNo}</span>
                  ) : null}

                  {ownedByMe ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`v${s.seqNo} 菜单`}
                          data-testid={`snapshot-menu-v${s.seqNo}`}
                          className="ml-auto opacity-30 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 hover:bg-ink-200 rounded-[var(--radius-sm)]"
                        >
                          <MoreHorizontal size={13} strokeWidth={2.25} className="text-ink-700" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => setRenameTarget(s)}>
                          重命名说明
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setRenameLabelTarget(s)}
                          data-testid={`menu-rename-label-v${s.seqNo}`}
                        >
                          重命名版本号
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setShareTarget(s)}
                          data-testid={`menu-share-v${s.seqNo}`}
                        >
                          分享
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeleteTarget(s)}
                          data-testid={`menu-delete-v${s.seqNo}`}
                        >
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <div className="text-[11px] text-ink-500 flex items-center gap-1.5">
                  <span>{s.uploaderName}</span>
                  {s.uploaderType !== "user" ? (
                    <span
                      className="inline-flex items-center px-1 py-px text-[9px] font-medium rounded-[var(--radius-sm)] bg-ink-100 text-ink-700 border border-ink-200"
                      title={s.uploaderType === "cli" ? "通过 prd CLI 上传" : "通过 MCP (AI agent) 上传"}
                      data-testid={`uploader-chip-v${s.seqNo}`}
                    >
                      {s.uploaderType === "cli" ? "CLI" : "AI"}
                    </span>
                  ) : null}
                  <span className="text-ink-300">·</span>
                  <span>{formatRelative(s.createdAt)}</span>
                </div>
                <div className="text-[12px] text-ink-700 line-clamp-2 mt-0.5">{s.changeNote}</div>
              </div>
            </li>
          );
        })}
      </ul>

      <RenameChangeNoteModal
        open={renameTarget !== null}
        target={renameTarget}
        versionId={versionId}
        onClose={() => setRenameTarget(null)}
      />
      <RenameDialog
        open={renameLabelTarget !== null}
        title="重命名方案版本号"
        subtitle={
          renameLabelTarget
            ? `当前：${renameLabelTarget.versionLabel ?? `v${renameLabelTarget.seqNo}（无自定义版本号）`}`
            : undefined
        }
        fieldLabel="版本号"
        initial={renameLabelTarget?.versionLabel ?? ""}
        maxLength={64}
        placeholder="例如：4.0.4"
        allowEmpty
        hint={`留空将清除自定义版本号，回到 v${renameLabelTarget?.seqNo ?? ""} 显示`}
        onClose={() => setRenameLabelTarget(null)}
        onSubmit={async (value) => {
          if (!renameLabelTarget) return;
          await snapshotsApi.rename(renameLabelTarget.id, versionId, {
            version_label: value === "" ? null : value,
          });
          toast.success("已保存");
          setRenameLabelTarget(null);
          router.refresh();
        }}
      />
      <DeleteSnapshotModal
        open={deleteTarget !== null}
        target={deleteTarget}
        versionId={versionId}
        onClose={() => setDeleteTarget(null)}
      />
      <ShareDialog
        open={shareTarget !== null}
        snapshot={shareTarget}
        onClose={() => setShareTarget(null)}
      />
    </>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

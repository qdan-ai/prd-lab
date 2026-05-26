"use client";

import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiFetch, type SnapshotRow } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface Props {
  versionId: string;
  /** 当前 URL `?snapshot=v{seq}` 解析出的 seq；null 表示无 query（默认显最新） */
  viewingSnapshotSeq: number | null;
  /** 紧凑（面包屑后段） / 略宽（底部 bar） */
  variant?: "sm" | "md";
  testIdSuffix?: string;
}

/**
 * 紧凑版本下拉 popover（S8 改造）：
 * - snapshot 平行化：不再有 "当前"/"草稿" 概念
 * - trigger 标签：URL 指定 seq → 用 list 中该 seq 的 versionLabel ?? v{seq}
 *                 否则取最新（seq 最大）的 versionLabel ?? v{seq}
 * - 列表项点击：set/clear `?snapshot=v{seq}` query
 */
export function SnapshotPopover({
  versionId,
  viewingSnapshotSeq,
  variant = "sm",
  testIdSuffix,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data } = useSWR<SnapshotRow[]>(
    `/api/v1/versions/${versionId}/snapshots`,
    (url: string) => apiFetch<SnapshotRow[]>(url),
    { keepPreviousData: true, dedupingInterval: 30_000 },
  );

  const list = data ?? [];
  // 选中 seq：URL viewing 优先，否则取最新（seq 最大；list 已 DESC）
  const latestSeq = list[0]?.seqNo ?? null;
  const activeSeq = viewingSnapshotSeq ?? latestSeq;
  const activeRow = activeSeq !== null ? list.find((s) => s.seqNo === activeSeq) : undefined;
  const labelText = activeRow
    ? activeRow.versionLabel ?? `v${activeRow.seqNo}`
    : list.length === 0
      ? "暂无版本"
      : `v${activeSeq}`;

  const onPick = (seq: number) => {
    const url = new URL(window.location.href);
    // 无 viewing 时点最新 = 清 query；否则切到目标 seq
    if (latestSeq === seq && viewingSnapshotSeq === null) {
      // 已是默认状态
    } else if (latestSeq === seq) {
      url.searchParams.delete("snapshot");
    } else {
      url.searchParams.set("snapshot", `v${seq}`);
    }
    void searchParams;
    router.push(`${url.pathname}${url.search}`, { scroll: false });
  };

  if (list.length === 0) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          "h-7 px-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)]",
          "text-ink-500 cursor-not-allowed select-none",
        )}
        title="暂无版本"
        aria-label="切换版本"
      >
        <span>{labelText}</span>
        <ChevronDown size={11} className="opacity-50" />
      </button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-7 inline-flex items-center gap-1 rounded-[var(--radius-sm)]",
            "text-ink-700 hover:text-ink-900 hover:bg-ink-100 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1",
            variant === "sm" ? "px-2 text-[12px]" : "px-2.5 text-[12px]",
          )}
          title="切换版本"
          aria-label="切换版本"
          data-testid={`snapshot-popover-trigger${testIdSuffix ?? ""}`}
        >
          <span className="font-medium tabular-nums">{labelText}</span>
          <ChevronDown size={11} className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[260px] p-1.5"
        data-testid={`snapshot-popover-content${testIdSuffix ?? ""}`}
      >
        <ul className="max-h-[320px] overflow-y-auto" role="list">
          {list.map((s) => {
            const isActive = activeSeq === s.seqNo;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s.seqNo)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-[var(--radius-sm)] hover:bg-ink-50 transition-colors",
                    isActive && "bg-ink-100",
                  )}
                  data-testid={`snapshot-popover-row-v${s.seqNo}`}
                >
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span
                      className="inline-flex items-center justify-center w-2 h-2 rounded-full shrink-0 border border-ink-400 bg-white"
                      aria-hidden
                    />
                    <span className="font-semibold tabular-nums text-ink-900">
                      {s.versionLabel ?? `v${s.seqNo}`}
                    </span>
                    {s.versionLabel ? (
                      <span className="text-[10px] text-ink-500 tabular-nums">v{s.seqNo}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-ink-500">{s.uploaderName}</span>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5 truncate">{s.changeNote}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ShareSwitcherItem = {
  seqNo: number;
  versionLabel: string | null;
  uploaderName: string;
  /** ISO string（SSR 传 client 需序列化） */
  createdAt: string;
};

interface Props {
  shareId: string;
  /** 方案下全部活跃 snapshot，seq 降序（list[0] = 最新） */
  items: ShareSwitcherItem[];
  activeSeq: number;
}

/**
 * S19 访客侧版本切换器：数据由 SSR props 传入（无 SWR / 无鉴权上下文）。
 * 选中 → router.push 切 `?snapshot=v{seq}` 触发整页 SSR；最新版 = 清 query。
 */
export function ShareSnapshotSwitcher({ shareId, items, activeSeq }: Props) {
  const router = useRouter();
  // 受控 open：searchParams 变化不卸载本组件，Radix 不会自动收起，选中后必须显式关
  const [open, setOpen] = useState(false);

  const latestSeq = items[0]?.seqNo ?? null;
  const activeRow = items.find((s) => s.seqNo === activeSeq);
  const labelText = activeRow ? (activeRow.versionLabel ?? `v${activeRow.seqNo}`) : `v${activeSeq}`;

  const onPick = (seq: number) => {
    setOpen(false);
    if (seq === activeSeq) return;
    const target = seq === latestSeq ? `/share/${shareId}` : `/share/${shareId}?snapshot=v${seq}`;
    router.push(target, { scroll: false });
  };

  if (items.length <= 1) {
    return (
      <span
        className="text-[12px] font-medium tabular-nums text-ink-700"
        data-testid="share-snapshot-switcher-static"
      >
        {labelText}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "h-7 px-2 inline-flex items-center gap-1 rounded-[var(--radius-sm)] text-[12px]",
            "text-ink-700 hover:text-ink-900 hover:bg-ink-100 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1",
          )}
          title="切换版本"
          aria-label="切换版本"
          data-testid="share-snapshot-switcher-trigger"
        >
          <span className="font-medium tabular-nums">{labelText}</span>
          <ChevronDown size={11} className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[260px] p-1.5"
        data-testid="share-snapshot-switcher-content"
      >
        <ul className="max-h-[320px] overflow-y-auto" role="list">
          {items.map((s) => {
            const isActive = activeSeq === s.seqNo;
            return (
              <li key={s.seqNo}>
                <button
                  type="button"
                  onClick={() => onPick(s.seqNo)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-[var(--radius-sm)] hover:bg-ink-50 transition-colors",
                    isActive && "bg-ink-100",
                  )}
                  data-testid={`share-snapshot-switcher-row-v${s.seqNo}`}
                >
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="font-semibold tabular-nums text-ink-900">
                      {s.versionLabel ?? `v${s.seqNo}`}
                    </span>
                    {s.versionLabel ? (
                      <span className="text-[10px] text-ink-500 tabular-nums">v{s.seqNo}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-ink-500">{s.uploaderName}</span>
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5 tabular-nums">
                    {new Date(s.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

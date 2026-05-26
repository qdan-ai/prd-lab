"use client";

import { Minus, Plus, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SnapshotPopover } from "@/components/snapshot-popover";

interface Props {
  versionId: string;
  viewingSnapshotSeq: number | null;
}

/**
 * 底部 bar 36px（S8：删 currentSnapshotSeq）
 */
export function BottomBar({ versionId, viewingSnapshotSeq }: Props) {
  return (
    <footer
      className="h-9 flex items-center gap-0.5 px-3 border-t border-ink-200 bg-white shrink-0 text-[12px]"
      role="contentinfo"
    >
      <div className="flex items-center bg-ink-50 rounded-[var(--radius-sm)] border border-ink-150 h-7 p-0.5">
        <Button variant="ghost" size="icon" disabled aria-label="缩小" title="缩小" className="h-6 w-6">
          <Minus size={11} strokeWidth={2.25} />
        </Button>
        <span className="text-ink-700 tabular-nums w-9 text-center text-[11px] font-medium select-none">
          100%
        </span>
        <Button variant="ghost" size="icon" disabled aria-label="放大" title="放大" className="h-6 w-6">
          <Plus size={11} strokeWidth={2.25} />
        </Button>
      </div>

      <Button variant="ghost" size="icon" disabled aria-label="适应宽度" title="适应宽度" className="ml-1">
        <Maximize2 size={12} strokeWidth={2.25} />
      </Button>

      <div className="flex-1" />

      <SnapshotPopover
        versionId={versionId}
        viewingSnapshotSeq={viewingSnapshotSeq}
        variant="md"
        testIdSuffix="-bottom"
      />
    </footer>
  );
}

"use client";

import { useSwitcherStore } from "@/components/command-switcher/use-switcher-store";
import { SnapshotPopover } from "@/components/snapshot-popover";
import { cn } from "@/lib/utils";

interface Props {
  projectName: string;
  versionName: string;
  versionId: string;
  viewingSnapshotSeq: number | null;
}

export function SegmentedBreadcrumb({
  projectName,
  versionName,
  versionId,
  viewingSnapshotSeq,
}: Props) {
  const openSwitcher = useSwitcherStore((s) => s.setOpen);

  return (
    <nav aria-label="项目/方案/版本" className="flex items-center text-[13px]">
      <button
        type="button"
        onClick={() => openSwitcher(true)}
        className={cn(
          "group h-7 px-2 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)]",
          "text-ink-900 transition-colors",
          "hover:bg-ink-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
        )}
        title="切换项目 / 方案 (⌘K)"
        aria-label="切换项目 / 方案"
        data-testid="breadcrumb-project-segment"
      >
        <span className="font-medium">{projectName}</span>
        <span className="text-ink-300 text-[12px] group-hover:text-ink-500 transition-colors">/</span>
        <span className="text-ink-700 group-hover:text-ink-900 transition-colors">{versionName}</span>
      </button>

      <span className="text-ink-300 select-none mx-0.5" aria-hidden>·</span>

      <SnapshotPopover
        versionId={versionId}
        viewingSnapshotSeq={viewingSnapshotSeq}
        variant="sm"
        testIdSuffix="-breadcrumb"
      />
    </nav>
  );
}

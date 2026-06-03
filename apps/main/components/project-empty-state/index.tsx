"use client";

import { FilePlus2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateDialogStore } from "@/components/create-dialog/use-create-dialog-store";

interface Props {
  projectId: string;
  projectName: string;
  /** 仅 owner 显示「新建方案」按钮；非 owner 看 team 项目时只读提示 */
  ownedByMe: boolean;
}

/** S17：项目「0 方案」落地空状态。 */
export function ProjectEmptyState({ projectId, projectName, ownedByMe }: Props) {
  const openVersion = useCreateDialogStore((s) => s.openVersion);

  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-[var(--radius-md)] bg-white border border-ink-200 shadow-[var(--shadow-sm)] mb-5">
          <FilePlus2 size={20} strokeWidth={1.75} className="text-ink-500" />
        </div>
        <h2 className="text-[17px] font-semibold text-ink-900 mb-1 tracking-tight">
          该项目还没有方案
        </h2>
        <p className="text-[13px] text-ink-500 mb-5 leading-relaxed">
          {ownedByMe
            ? "建一个方案，开始上传你的版本"
            : "项目所有者还没有创建任何方案"}
        </p>
        {ownedByMe ? (
          <Button
            variant="primary"
            size="md"
            className="gap-1.5"
            onClick={() => openVersion(projectId, projectName)}
            data-testid="empty-create-version"
          >
            <Plus size={14} strokeWidth={2.25} />
            <span>新建方案</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

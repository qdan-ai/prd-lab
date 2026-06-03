"use client";

import { useState } from "react";
import { ArrowLeftRight, MoreHorizontal, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebarStore } from "@/components/layout/sidebar-store";
import { useSwitcherStore } from "@/components/command-switcher/use-switcher-store";
import { useModalStack } from "@/components/modal-stack";
import { SnapshotList } from "@/components/sidebar-left/snapshot-list";
import { UploadSnapshotModal } from "@/components/upload-snapshot-modal";
import { DeleteVersionModal } from "@/components/delete-version-modal";
import { cn } from "@/lib/utils";

interface Props {
  versionId?: string;
  projectId?: string;
  versionName?: string;
  ownedByMe?: boolean;
}

/**
 * 左抽屉（S8：snapshot 平行化）：280px overlay
 * 顶部 ⇆ 切换方案 ⌘K + ⋯ 菜单（删除当前方案）| 中部全部版本 | 底部 + 上传新版本
 */
export function SidebarLeft({ versionId, projectId, versionName, ownedByMe = true }: Props) {
  const open = useSidebarStore((s) => s.leftOpen);
  const close = useSidebarStore((s) => s.setLeft);
  const openSwitcher = useSwitcherStore((s) => s.setOpen);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 上传 / 删除 modal 优先级高于抽屉自身（ESC 先关 modal）
  useModalStack(open && !uploadOpen && !deleteOpen, () => {
    close(false);
  });

  if (!open) return null;

  // 不再用 fixed inset-0 overlay：过去会拦截 wheel/touch 导致背景画板无法滚动。
  // 抽屉是非 modal overlay，关闭依赖 X 按钮 + ESC（useModalStack 已挂）。
  const canManage = ownedByMe && !!versionId && !!projectId;

  return (
    <>
      <aside
        className={cn(
          "fixed left-0 top-11 bottom-9 z-40 w-[280px]",
          "bg-white border-r border-ink-200 shadow-[var(--shadow-md)]",
          "flex flex-col prd-sidebar-left-enter",
        )}
        role="complementary"
        aria-label="全部版本"
        data-testid="sidebar-left"
      >
        <div className="h-11 flex items-center justify-between px-3 border-b border-ink-200 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openSwitcher(true)}
            aria-label="切换项目 / 方案"
            title="切换项目 / 方案 (⌘K)"
            className="gap-1.5"
          >
            <ArrowLeftRight size={12} strokeWidth={2.25} />
            <span>切换方案</span>
            <kbd className="ml-0.5">⌘K</kbd>
          </Button>
          <div className="flex items-center gap-1">
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="方案操作"
                    title="方案操作"
                    data-testid="sidebar-version-menu"
                  >
                    <MoreHorizontal size={14} strokeWidth={2.25} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    destructive
                    className="gap-2"
                    onSelect={() => setDeleteOpen(true)}
                    data-testid="sidebar-delete-version"
                  >
                    <Trash2 size={13} />
                    删除当前方案
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => close(false)}
              aria-label="关闭左抽屉"
              title="关闭 (ESC)"
            >
              <X size={12} strokeWidth={2.5} />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="text-[10px] font-semibold text-ink-500 uppercase tracking-[0.08em] mb-2 px-2 select-none">
            全部版本
          </div>
          {versionId ? <SnapshotList versionId={versionId} ownedByMe={ownedByMe} /> : null}
        </div>

        <div className="border-t border-ink-200 p-2.5 shrink-0">
          <Button
            variant="secondary"
            size="md"
            className="w-full gap-2"
            disabled={!versionId || !ownedByMe}
            onClick={() => setUploadOpen(true)}
            data-testid="open-upload-modal"
            title={ownedByMe ? undefined : "仅项目所有者可上传快照"}
          >
            <Upload size={13} strokeWidth={2.25} />
            <span>上传新版本</span>
          </Button>
        </div>
      </aside>
      {versionId ? (
        <UploadSnapshotModal
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          versionId={versionId}
        />
      ) : null}
      {canManage ? (
        <DeleteVersionModal
          open={deleteOpen}
          target={{ id: versionId!, name: versionName ?? "当前方案" }}
          projectId={projectId!}
          redirectTo={`/projects/${projectId}`}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
    </>
  );
}

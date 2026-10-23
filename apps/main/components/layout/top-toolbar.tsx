"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Search, Download, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedBreadcrumb } from "@/components/breadcrumb/segmented-breadcrumb";
import { useSidebarStore } from "@/components/layout/sidebar-store";
import { useSwitcherStore } from "@/components/command-switcher/use-switcher-store";
import { UserMenu } from "@/components/layout/user-menu";
import { ShareDialog } from "@/components/share-dialog";

interface Props {
  projectName: string;
  visibility: "private" | "team";
  versionName: string;
  versionId: string;
  viewingSnapshotSeq: number | null;
  /** 当前正在预览的 snapshot id（null 时禁用导出） */
  snapshotId: string | null;
  /** 是否项目 owner，仅 owner 才显示分享按钮 */
  ownedByMe: boolean;
  /** 当前登入用户名 */
  userName: string;
  /** 登出 server action */
  logoutAction: () => Promise<void>;
}

/**
 * 顶 toolbar 44px（S19：分享改方案级，绑当前 version）：
 * - 分享按钮仅 owner 可见，恒可用（空方案也能建分享，访客见空态）
 * - 分享的唯一 UI 入口（左抽屉快照行菜单的"分享"已随方案级改造移除）
 */
export function TopToolbar({
  projectName,
  visibility,
  versionName,
  versionId,
  viewingSnapshotSeq,
  snapshotId,
  ownedByMe,
  userName,
  logoutAction,
}: Props) {
  async function handleLogout() {
    await logoutAction();
  }
  const toggleLeft = useSidebarStore((s) => s.toggleLeft);
  const leftOpen = useSidebarStore((s) => s.leftOpen);
  const openSwitcher = useSwitcherStore((s) => s.setOpen);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <header
      className="h-11 flex items-center gap-1.5 px-3 border-b border-ink-200 bg-white shrink-0"
      role="banner"
    >
      <Button
        variant={leftOpen ? "secondary" : "ghost"}
        size="icon"
        onClick={toggleLeft}
        aria-label="切换左抽屉"
        data-testid="toggle-left-sidebar"
        title="全部版本"
      >
        <Menu size={14} strokeWidth={2.25} />
      </Button>

      <Link
        href="/projects"
        prefetch
        className="flex items-center gap-1.5 pl-1 pr-2 select-none rounded-[var(--radius-sm)] hover:bg-ink-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
        aria-label="返回首页"
        title="返回首页"
        data-testid="home-link"
      >
        <div className="w-5 h-5 rounded-[var(--radius-sm)] bg-ink-900 text-ink-50 text-[10px] font-semibold flex items-center justify-center">
          P
        </div>
        <span className="text-[13px] font-semibold tracking-tight text-ink-900">
          PRD-Lab
        </span>
      </Link>

      <div className="h-4 w-px bg-ink-200 mx-0.5" aria-hidden />

      <SegmentedBreadcrumb
        projectName={projectName}
        versionName={versionName}
        versionId={versionId}
        viewingSnapshotSeq={viewingSnapshotSeq}
      />

      <Button
        variant="ghost"
        size="icon"
        onClick={() => openSwitcher(true)}
        aria-label="搜索项目"
        title="搜索项目 / 方案 (⌘K)"
      >
        <Search size={14} strokeWidth={2.25} />
      </Button>

      <div className="flex-1" />

      {ownedByMe ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="分享"
          title="分享方案"
          onClick={() => setShareOpen(true)}
          data-testid="toolbar-share-button"
        >
          <Share2 size={14} strokeWidth={2.25} />
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="icon"
        aria-label="导出"
        title="导出 zip"
        onClick={() => {
          window.location.href = `/api/v1/exports/${versionId}`;
        }}
        disabled={snapshotId === null}
        data-testid="export-button"
      >
        <Download size={14} strokeWidth={2.25} />
      </Button>

      <div className="h-4 w-px bg-ink-200 mx-1" aria-hidden />
      <UserMenu userName={userName} onLogout={handleLogout} />

      <ShareDialog
        open={shareOpen}
        visibility={visibility}
        version={{ id: versionId, name: versionName }}
        onClose={() => setShareOpen(false)}
      />
    </header>
  );
}

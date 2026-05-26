"use client";

import Link from "next/link";
import { OpenSwitcherButton } from "@/components/command-switcher/open-switcher-button";
import { UserMenu } from "@/components/layout/user-menu";

interface Props {
  userName: string;
  logoutAction: () => Promise<void>;
}

export function ProjectsHeader({ userName, logoutAction }: Props) {
  async function handleLogout() {
    await logoutAction();
  }
  return (
    <header className="h-12 flex items-center justify-between px-5 border-b border-ink-200 bg-white sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <Link
          href="/projects"
          aria-label="回到工作台"
          title="回到工作台"
          className="flex items-center gap-2 select-none rounded-[var(--radius-sm)] -mx-1 px-1 py-0.5 hover:bg-ink-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
          data-testid="header-logo"
        >
          <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-ink-900 text-ink-50 text-[11px] font-semibold flex items-center justify-center">
            P
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-ink-900">
            PRD-Lab
          </span>
        </Link>
        <div className="h-4 w-px bg-ink-200" aria-hidden />
        <OpenSwitcherButton />
      </div>
      <UserMenu userName={userName} onLogout={handleLogout} />
    </header>
  );
}

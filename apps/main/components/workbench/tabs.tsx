import Link from "next/link";

export type WorkbenchTab = "mine" | "team";

interface Props {
  active: WorkbenchTab;
  mineCount: number;
  teamCount: number;
}

export function WorkbenchTabs({ active, mineCount, teamCount }: Props) {
  return (
    <div className="flex items-center gap-6" role="tablist">
      <TabLink href="/projects?tab=mine" active={active === "mine"} label="我的项目" count={mineCount} />
      <TabLink href="/projects?tab=team" active={active === "team"} label="团队项目" count={teamCount} />
    </div>
  );
}

interface TabLinkProps {
  href: string;
  active: boolean;
  label: string;
  count: number;
}

function TabLink({ href, active, label, count }: TabLinkProps) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      scroll={false}
      className={`relative inline-flex items-center gap-1.5 pb-2.5 text-[14px] font-medium select-none
        transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 rounded-[var(--radius-sm)]
        ${
          active
            ? "text-ink-900 after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px] after:bg-ink-900"
            : "text-ink-500 hover:text-ink-700"
        }`}
      data-testid={`workbench-tab-${active ? "active" : "inactive"}`}
    >
      <span>{label}</span>
      <span className="text-[11px] tabular-nums text-ink-400">{count}</span>
    </Link>
  );
}

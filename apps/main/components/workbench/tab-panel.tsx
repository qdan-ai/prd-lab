"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, FolderOpen, Lock, Users } from "lucide-react";
import { OpenSwitcherButton } from "@/components/command-switcher/open-switcher-button";
import { formatRelative } from "./format";
import { useWorkbenchSearchStore } from "./search-store";

export type WorkbenchTab = "mine" | "team";

export interface WorkbenchProject {
  id: string;
  name: string;
  visibility: "private" | "team";
  createdAt: string;
  firstVersionId: string | null;
  snapshotCount: number;
  latestSnapshotAt: string | null;
}

interface Props {
  tab: WorkbenchTab;
  projects: WorkbenchProject[];
}

export function WorkbenchTabPanel({ tab, projects }: Props) {
  const query = useWorkbenchSearchStore((s) => s.query);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(kw));
  }, [projects, query]);

  if (filtered.length === 0) {
    return <EmptyState tab={tab} hasQuery={query.trim().length > 0} />;
  }

  return (
    <ul
      className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      data-testid="workbench-grid"
    >
      {filtered.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </ul>
  );
}

function ProjectCard({ project }: { project: WorkbenchProject }) {
  const v = project.firstVersionId;
  const disabled = !v;
  return (
    <li>
      <Link
        href={v ? `/projects/${project.id}/versions/${v}` : "#"}
        aria-disabled={disabled}
        className={`group relative block rounded-[var(--radius-md)] bg-white border border-ink-200 p-4 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 ${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "hover:bg-ink-50/60 hover:border-ink-300 hover:shadow-[var(--shadow-sm)]"
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="text-[14px] font-semibold text-ink-900 truncate leading-tight pr-1">
            {project.name}
          </div>
          <VisibilityChip visibility={project.visibility} />
        </div>

        <CardMeta project={project} />

        <ArrowRight
          size={13}
          className="absolute bottom-3 right-3 text-ink-300 group-hover:text-ink-700 group-hover:translate-x-0.5 transition-all"
        />
      </Link>
    </li>
  );
}

function CardMeta({ project }: { project: WorkbenchProject }) {
  const hasSnapshot = project.snapshotCount > 0;
  const primary = hasSnapshot ? (
    <span className="text-ink-700">
      {project.snapshotCount} 个版本
      {project.latestSnapshotAt ? (
        <>
          <span className="text-ink-300 mx-1.5">·</span>
          <span className="text-ink-500">
            最近 {formatRelative(project.latestSnapshotAt)}
          </span>
        </>
      ) : null}
    </span>
  ) : (
    <span className="text-ink-400">还没有上传版本</span>
  );

  return (
    <div className="text-[12px]">
      <div className="tabular-nums">{primary}</div>
      <div className="mt-3 pt-3 border-t border-ink-150 text-[11px] text-ink-400 select-none tabular-nums">
        创建于 {formatRelative(project.createdAt)}
      </div>
    </div>
  );
}

function VisibilityChip({ visibility }: { visibility: "private" | "team" }) {
  const isPrivate = visibility === "private";
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[var(--radius-sm)] border ${
        isPrivate
          ? "text-ink-500 bg-white border-ink-200"
          : "text-ink-700 bg-ink-100 border-ink-200"
      }`}
      title={isPrivate ? "私有项目（仅自己可见）" : "团队项目（所有登入用户可见）"}
    >
      {isPrivate ? (
        <Lock size={9} strokeWidth={2.25} />
      ) : (
        <Users size={9} strokeWidth={2.25} />
      )}
      {isPrivate ? "私有" : "团队"}
    </span>
  );
}

function EmptyState({ tab, hasQuery }: { tab: WorkbenchTab; hasQuery: boolean }) {
  if (hasQuery) {
    return (
      <div className="border border-dashed border-ink-200 rounded-[var(--radius-lg)] p-12 text-center bg-ink-50">
        <p className="text-[13px] text-ink-500">没有匹配的项目</p>
      </div>
    );
  }
  const isTeam = tab === "team";
  const title = isTeam ? "团队里还没有公开项目" : "这里还很空";
  const hint = isTeam
    ? "等其他成员把可见性设为「团队」时会出现在这里"
    : "从右上角创建你的第一个项目";
  return (
    <div className="border border-dashed border-ink-200 rounded-[var(--radius-lg)] p-16 text-center bg-ink-50">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-[var(--radius-md)] bg-white border border-ink-200 shadow-[var(--shadow-sm)] mb-5">
        <FolderOpen size={20} strokeWidth={1.75} className="text-ink-500" />
      </div>
      <h2 className="text-[17px] font-semibold text-ink-900 mb-1 tracking-tight">{title}</h2>
      <p className="text-[13px] text-ink-500 mb-5 max-w-sm mx-auto leading-relaxed">{hint}</p>
      {!isTeam ? <OpenSwitcherButton variant="primary" label="新建项目" /> : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, FolderOpen, Lock, MoreHorizontal, Trash2, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteProjectModal } from "@/components/delete-project-modal";
import { useCreateDialogStore } from "@/components/create-dialog/use-create-dialog-store";
import { formatRelative } from "./format";
import { useWorkbenchSearchStore } from "./search-store";

export type WorkbenchTab = "mine" | "team";

export interface WorkbenchProject {
  id: string;
  name: string;
  visibility: "private" | "team";
  createdAt: string;
  ownedByMe: boolean;
  snapshotCount: number;
  latestSnapshotAt: string | null;
}

interface Props {
  tab: WorkbenchTab;
  projects: WorkbenchProject[];
}

export function WorkbenchTabPanel({ tab, projects }: Props) {
  const query = useWorkbenchSearchStore((s) => s.query);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(kw));
  }, [projects, query]);

  if (filtered.length === 0) {
    return <EmptyState tab={tab} hasQuery={query.trim().length > 0} />;
  }

  return (
    <>
      <ul
        className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        data-testid="workbench-grid"
      >
        {filtered.map((p) => (
          <ProjectCard key={p.id} project={p} onDelete={() => setDeleteTarget({ id: p.id, name: p.name })} />
        ))}
      </ul>
      <DeleteProjectModal
        open={deleteTarget !== null}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}

function ProjectCard({ project, onDelete }: { project: WorkbenchProject; onDelete: () => void }) {
  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="group relative block rounded-[var(--radius-md)] bg-white border border-ink-200 p-4 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 hover:bg-ink-50/60 hover:border-ink-300 hover:shadow-[var(--shadow-sm)]"
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="text-[14px] font-semibold text-ink-900 truncate leading-tight pr-1">
            {project.name}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <VisibilityChip visibility={project.visibility} />
            {project.ownedByMe ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    aria-label={`${project.name} 菜单`}
                    data-testid={`card-menu-${project.id}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 hover:bg-ink-200 rounded-[var(--radius-sm)]"
                  >
                    <MoreHorizontal size={14} strokeWidth={2.25} className="text-ink-700" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <DropdownMenuItem
                    destructive
                    onSelect={onDelete}
                    data-testid={`card-delete-${project.id}`}
                    className="gap-2"
                  >
                    <Trash2 size={13} />
                    删除项目
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
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
  const openProject = useCreateDialogStore((s) => s.openProject);
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
      {!isTeam ? (
        <Button
          variant="primary"
          size="md"
          className="gap-1.5"
          onClick={() => openProject()}
          data-testid="empty-new-project"
        >
          <Plus size={14} strokeWidth={2.25} />
          <span>新建项目</span>
        </Button>
      ) : null}
    </div>
  );
}

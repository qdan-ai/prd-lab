"use client";

import useSWR from "swr";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, X, Plus, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSwitcherStore } from "./use-switcher-store";
import { useCreateDialogStore } from "@/components/create-dialog/use-create-dialog-store";
import { useModalStack } from "@/components/modal-stack";
import { apiFetch, projectsApi, versionsApi, type SwitcherProject } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { RenameDialog } from "@/components/rename-dialog";
import { DeleteProjectModal } from "@/components/delete-project-modal";
import { DeleteVersionModal } from "@/components/delete-version-modal";

type SwitcherVersion = SwitcherProject["versions"][number];

const SWITCHER_KEY = "/api/v1/projects?view=switcher";

export function CommandSwitcher() {
  const open = useSwitcherStore((s) => s.open);
  const setOpen = useSwitcherStore((s) => s.setOpen);
  const query = useSwitcherStore((s) => s.query);
  const setQuery = useSwitcherStore((s) => s.setQuery);
  const focusedProjectId = useSwitcherStore((s) => s.focusedProjectId);
  const setFocusedProject = useSwitcherStore((s) => s.setFocusedProject);
  const reset = useSwitcherStore((s) => s.reset);

  const openProjectDialog = useCreateDialogStore((s) => s.openProject);
  const openVersionDialog = useCreateDialogStore((s) => s.openVersion);

  const router = useRouter();
  const params = useParams<{ pid?: string }>();
  const currentPid = params?.pid;

  // 重命名 / 删除 modal 状态
  const [renameProjectTarget, setRenameProjectTarget] = useState<SwitcherProject | null>(null);
  const [renameVersionTarget, setRenameVersionTarget] = useState<SwitcherVersion | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<SwitcherProject | null>(null);
  const [deleteVersionTarget, setDeleteVersionTarget] = useState<
    { version: SwitcherVersion; projectId: string } | null
  >(null);

  // ESC：关闭整个弹窗（创建/删除已迁出为独立 modal，由各自 modalStack 处理）
  useModalStack(open, () => {
    setOpen(false);
    return true;
  });

  // 组件 mount 后立即 fetch（CommandSwitcher 仅在登入页面 mount），
  // 弹窗打开时数据已就绪，消除"等加载"卡顿。
  const { data, error, isLoading, mutate } = useSWR<SwitcherProject[]>(
    SWITCHER_KEY,
    (key: string) => apiFetch<SwitcherProject[]>(key, {}, { silent: true }),
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      revalidateIfStale: true,
      keepPreviousData: true,
    },
  );

  // 设置默认 focusedProjectId
  useEffect(() => {
    if (!open || !data || data.length === 0) return;
    if (focusedProjectId && data.some((p) => p.id === focusedProjectId)) return;
    const next =
      data.find((p) => p.id === currentPid)?.id ??
      data[0]?.id ??
      null;
    setFocusedProject(next);
  }, [open, data, focusedProjectId, currentPid, setFocusedProject]);

  // 关闭时清查询
  useEffect(() => {
    if (!open) setQuery("");
  }, [open, setQuery]);

  // 过滤
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true;
      return p.versions.some((v) => v.name.toLowerCase().includes(q));
    });
  }, [data, query]);

  const focusedProject = useMemo(
    () => (focusedProjectId ? data?.find((p) => p.id === focusedProjectId) ?? null : null),
    [data, focusedProjectId],
  );

  // 新建项目 / 方案：关闭 switcher 后打开独立聚焦弹窗
  function startCreateProject() {
    setOpen(false);
    openProjectDialog();
  }
  function startCreateVersion(projectId: string, projectName: string) {
    setOpen(false);
    openVersionDialog(projectId, projectName);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showClose={false}
        className="w-[640px] h-[480px] flex flex-col p-0"
        onEscapeKeyDown={(e) => e.preventDefault() /* 让 ModalStackProvider 处理 */}
        aria-label="切换项目 / 方案"
      >
        <DialogTitle className="sr-only">切换项目 / 方案</DialogTitle>
        <DialogDescription className="sr-only">
          搜索项目或方案名，cmd+K 唤起，ESC 关闭
        </DialogDescription>

        <header className="border-b border-ink-200 px-3 py-2 flex items-center gap-2">
          <Search size={14} className="text-ink-500 shrink-0" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目或方案名..."
            autoFocus
            className="border-0 focus-visible:ring-0 px-0 h-7"
            // 弹窗内 cmd+K 关闭
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="关闭"
            className="text-ink-500 hover:text-ink-900 p-1"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* 左列：项目 */}
          <div className="w-[240px] border-r border-ink-200 flex flex-col">
            <div className="flex-1 overflow-y-auto py-2">
              <div className="px-3 py-1 text-xs font-semibold text-ink-700 select-none">项目</div>
              {isLoading ? (
                <div className="px-2 space-y-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-7" />
                  ))}
                </div>
              ) : error ? (
                <ErrorState onRetry={() => mutate()} />
              ) : filtered.length === 0 && data?.length === 0 ? (
                <EmptyProjectsState onCreate={startCreateProject} />
              ) : (
                <ul role="listbox" aria-label="项目列表" className="px-1">
                  {filtered.map((p) => (
                    <li key={p.id}>
                      <div
                        role="option"
                        tabIndex={0}
                        aria-selected={focusedProjectId === p.id}
                        onClick={() => setFocusedProject(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setFocusedProject(p.id);
                          }
                        }}
                        className={cn(
                          "group w-full text-left px-2 h-9 flex items-center text-sm rounded cursor-pointer",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900",
                          focusedProjectId === p.id
                            ? "bg-accent-bg text-ink-950"
                            : "hover:bg-ink-100 text-ink-900",
                        )}
                      >
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-[10px] text-ink-500 shrink-0 ml-2">
                          {p.versions.length} 方案
                        </span>
                        {p.ownedByMe ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`${p.name} 菜单`}
                                data-testid={`project-menu-${p.id}`}
                                className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 hover:bg-ink-200 rounded-[var(--radius-sm)]"
                              >
                                <MoreHorizontal size={13} strokeWidth={2.25} className="text-ink-700" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem onSelect={() => setRenameProjectTarget(p)}>
                                重命名项目
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={async () => {
                                  const next = p.visibility === "team" ? "private" : "team";
                                  try {
                                    await projectsApi.rename(p.id, { visibility: next });
                                    toast.success(next === "team" ? "已改为团队可见" : "已改为私有");
                                    await mutate();
                                    router.refresh();
                                  } catch {
                                    // toast 已自动
                                  }
                                }}
                              >
                                {p.visibility === "team" ? "改为私有" : "改为团队可见"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                destructive
                                className="gap-2"
                                onSelect={() => setDeleteProjectTarget(p)}
                                data-testid={`project-delete-${p.id}`}
                              >
                                <Trash2 size={13} />
                                删除项目
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-ink-200 p-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={startCreateProject}
                className="w-full gap-1.5"
              >
                <Plus size={14} />
                <span>新建项目</span>
              </Button>
            </div>
          </div>

          {/* 右列：方案 */}
          <div className="flex-1 flex flex-col">
            <VersionPanel
              project={focusedProject}
              onCreateVersion={() =>
                focusedProject && startCreateVersion(focusedProject.id, focusedProject.name)
              }
              onPickVersion={(vid) => {
                if (!focusedProject) return;
                const url = `/projects/${focusedProject.id}/versions/${vid}`;
                // 提前 prefetch + reset → router.push（客户端路由，比全页刷新快很多）
                router.prefetch(url);
                reset();
                router.push(url);
              }}
              onRenameVersion={(v) => setRenameVersionTarget(v)}
              onDeleteVersion={(v) =>
                focusedProject &&
                setDeleteVersionTarget({ version: v, projectId: focusedProject.id })
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>

      <RenameDialog
        open={renameProjectTarget !== null}
        title="重命名项目"
        subtitle={renameProjectTarget ? `当前：${renameProjectTarget.name}` : undefined}
        fieldLabel="项目名称"
        initial={renameProjectTarget?.name ?? ""}
        maxLength={128}
        placeholder="如：AI 投顾"
        onClose={() => setRenameProjectTarget(null)}
        onSubmit={async (value) => {
          if (!renameProjectTarget) return;
          await projectsApi.rename(renameProjectTarget.id, { name: value });
          toast.success("已重命名");
          await mutate();
          router.refresh();
          setRenameProjectTarget(null);
        }}
      />

      <RenameDialog
        open={renameVersionTarget !== null}
        title="重命名方案"
        subtitle={renameVersionTarget ? `当前：${renameVersionTarget.name}` : undefined}
        fieldLabel="方案名称"
        initial={renameVersionTarget?.name ?? ""}
        maxLength={64}
        placeholder="如：AI 选好股 4.0"
        onClose={() => setRenameVersionTarget(null)}
        onSubmit={async (value) => {
          if (!renameVersionTarget) return;
          await versionsApi.rename(renameVersionTarget.id, { name: value });
          toast.success("已重命名");
          await mutate();
          router.refresh();
          setRenameVersionTarget(null);
        }}
      />

      <DeleteProjectModal
        open={deleteProjectTarget !== null}
        target={deleteProjectTarget ? { id: deleteProjectTarget.id, name: deleteProjectTarget.name } : null}
        // 删的是当前正在看的项目 → 回工作台；否则留在原页只刷新
        redirectTo={deleteProjectTarget?.id === currentPid ? "/projects" : undefined}
        onClose={() => setDeleteProjectTarget(null)}
        onDeleted={() => {
          void mutate();
          setOpen(false);
        }}
      />

      <DeleteVersionModal
        open={deleteVersionTarget !== null}
        target={
          deleteVersionTarget
            ? { id: deleteVersionTarget.version.id, name: deleteVersionTarget.version.name }
            : null
        }
        projectId={deleteVersionTarget?.projectId ?? ""}
        // 删的方案正好是当前路由的项目 → 回项目落地页（自动转发/空状态）；否则只刷新
        redirectTo={
          deleteVersionTarget?.projectId === currentPid
            ? `/projects/${deleteVersionTarget?.projectId}`
            : undefined
        }
        onClose={() => setDeleteVersionTarget(null)}
        onDeleted={() => {
          void mutate();
          setOpen(false);
        }}
      />
    </>
  );
}

// ---- subviews ----

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-3 py-6 text-center text-sm">
      <div className="text-red-600 mb-2">无法加载</div>
      <button
        type="button"
        onClick={onRetry}
        className="text-ink-900 hover:underline text-xs"
      >
        重试
      </button>
    </div>
  );
}

function EmptyProjectsState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-3 py-6 text-center">
      <div className="text-sm text-ink-700 font-medium mb-1">还没有项目</div>
      <p className="text-xs text-ink-500 mb-3">建第一个项目开始</p>
      <Button variant="primary" size="sm" onClick={onCreate} className="gap-1.5">
        <Plus size={14} />
        <span>新建项目</span>
      </Button>
    </div>
  );
}

function VersionPanel({
  project,
  onCreateVersion,
  onPickVersion,
  onRenameVersion,
  onDeleteVersion,
}: {
  project: SwitcherProject | null;
  onCreateVersion: () => void;
  onPickVersion: (vid: string) => void;
  onRenameVersion: (v: SwitcherVersion) => void;
  onDeleteVersion: (v: SwitcherVersion) => void;
}) {
  const router = useRouter();
  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-ink-500">
        选择左侧项目查看方案
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 py-1 text-xs font-semibold text-ink-700 select-none">
          方案
        </div>
        {project.versions.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-ink-500">
            该项目暂无方案
          </div>
        ) : (
          <ul role="listbox" aria-label="方案列表" className="px-1">
            {project.versions.map((v) => (
              <li key={v.id}>
                <div
                  role="option"
                  tabIndex={0}
                  onMouseEnter={() => {
                    if (project) router.prefetch(`/projects/${project.id}/versions/${v.id}`);
                  }}
                  onClick={() => onPickVersion(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPickVersion(v.id);
                    }
                  }}
                  className="group w-full text-left px-2 py-1.5 rounded hover:bg-ink-100 text-sm flex items-center justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
                >
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-ink-900 truncate">{v.name}</span>
                    <span className="text-[11px] text-ink-500">
                      seq v{v.seqNo} · {v.activeCount} 活跃快照
                    </span>
                  </div>
                  {project.ownedByMe ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`${v.name} 菜单`}
                          data-testid={`version-menu-${v.id}`}
                          className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 hover:bg-ink-200 rounded-[var(--radius-sm)] shrink-0"
                        >
                          <MoreHorizontal size={13} strokeWidth={2.25} className="text-ink-700" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => onRenameVersion(v)}>
                          重命名方案
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          className="gap-2"
                          onSelect={() => onDeleteVersion(v)}
                          data-testid={`version-delete-${v.id}`}
                        >
                          <Trash2 size={13} />
                          删除方案
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  <ChevronRight
                    size={14}
                    className="text-ink-300 group-hover:text-ink-700 ml-1 shrink-0"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {project.ownedByMe ? (
        <div className="border-t border-ink-200 p-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCreateVersion}
            className="w-full gap-1.5"
          >
            <Plus size={14} />
            <span>在 {project.name} 下新建方案</span>
          </Button>
        </div>
      ) : null}
    </>
  );
}

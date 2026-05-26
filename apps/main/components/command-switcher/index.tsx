"use client";

import useSWR from "swr";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, X, Plus, ArrowLeft, ChevronRight, MoreHorizontal } from "lucide-react";
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
import { useModalStack } from "@/components/modal-stack";
import { apiFetch, projectsApi, versionsApi, type SwitcherProject } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { RenameDialog } from "@/components/rename-dialog";

type SwitcherVersion = SwitcherProject["versions"][number];

const SWITCHER_KEY = "/api/v1/projects?view=switcher";

export function CommandSwitcher() {
  const open = useSwitcherStore((s) => s.open);
  const setOpen = useSwitcherStore((s) => s.setOpen);
  const query = useSwitcherStore((s) => s.query);
  const setQuery = useSwitcherStore((s) => s.setQuery);
  const focusedProjectId = useSwitcherStore((s) => s.focusedProjectId);
  const setFocusedProject = useSwitcherStore((s) => s.setFocusedProject);
  const createMode = useSwitcherStore((s) => s.createMode);
  const setCreateMode = useSwitcherStore((s) => s.setCreateMode);
  const reset = useSwitcherStore((s) => s.reset);

  const router = useRouter();
  const params = useParams<{ pid?: string }>();
  const currentPid = params?.pid;

  // 重命名 modal 状态
  const [renameProjectTarget, setRenameProjectTarget] = useState<SwitcherProject | null>(null);
  const [renameVersionTarget, setRenameVersionTarget] = useState<SwitcherVersion | null>(null);

  // ESC LIFO：在 createMode 时 ESC 仅退出 createMode；否则关闭整个弹窗
  useModalStack(open, () => {
    if (createMode !== "none") {
      setCreateMode("none");
      return true;
    }
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
    if (!open) {
      setQuery("");
      setCreateMode("none");
    }
  }, [open, setQuery, setCreateMode]);

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
              {isLoading ? (
                <div className="px-2 space-y-2">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-7" />
                  ))}
                </div>
              ) : error ? (
                <ErrorState onRetry={() => mutate()} />
              ) : filtered.length === 0 && data?.length === 0 ? (
                <EmptyProjectsState onCreate={() => setCreateMode("project")} />
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
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                onClick={() => setCreateMode("project")}
                className="w-full gap-1.5"
              >
                <Plus size={14} />
                <span>新建项目</span>
              </Button>
            </div>
          </div>

          {/* 右列：方案（或 createMode form） */}
          <div className="flex-1 flex flex-col">
            {createMode === "project" ? (
              <CreateProjectForm
                onCancel={() => setCreateMode("none")}
                onCreated={async () => {
                  await mutate();
                  setCreateMode("none");
                }}
              />
            ) : (
              <VersionPanel
                project={focusedProject}
                onCreateVersion={() => setCreateMode("version")}
                createMode={createMode}
                onCancelCreate={() => setCreateMode("none")}
                onVersionCreated={async () => {
                  await mutate();
                  setCreateMode("none");
                }}
                onPickVersion={(vid) => {
                  if (!focusedProject) return;
                  const url = `/projects/${focusedProject.id}/versions/${vid}`;
                  // 提前 prefetch + reset → router.push（客户端路由，比全页刷新快很多）
                  router.prefetch(url);
                  reset();
                  router.push(url);
                }}
                onRenameVersion={(v) => setRenameVersionTarget(v)}
              />
            )}
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
  createMode,
  onCancelCreate,
  onVersionCreated,
  onPickVersion,
  onRenameVersion,
}: {
  project: SwitcherProject | null;
  onCreateVersion: () => void;
  createMode: "none" | "version" | "project";
  onCancelCreate: () => void;
  onVersionCreated: () => Promise<void>;
  onPickVersion: (vid: string) => void;
  onRenameVersion: (v: SwitcherVersion) => void;
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
        <div className="px-3 py-1 text-xs font-medium text-ink-500 select-none">
          {project.name} 的方案
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
                    </DropdownMenuContent>
                  </DropdownMenu>
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
      <div className="border-t border-ink-200 p-2 shrink-0">
        {createMode === "version" ? (
          <CreateVersionForm
            projectId={project.id}
            projectName={project.name}
            onCancel={onCancelCreate}
            onCreated={onVersionCreated}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onCreateVersion}
            className="w-full gap-1.5"
          >
            <Plus size={14} />
            <span>在 {project.name} 下新建方案</span>
          </Button>
        )}
      </div>
    </>
  );
}

function CreateProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const router = useRouter();
  const reset = useSwitcherStore((s) => s.reset);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">("team");
  const [firstVersionName, setFirstVersionName] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const result = await projectsApi.create({ name: name.trim(), visibility, firstVersionName });
      const url = `/projects/${result.project.id}/versions/${result.version.id}`;
      router.prefetch(url);
      toast.success("项目已创建");
      // 不 await onCreated()：mutate 在后台跑，立即跳转
      void onCreated();
      reset();
      router.push(url);
    } catch {
      // toast 已在 apiFetch 里弹
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
      <button
        type="button"
        onClick={onCancel}
        className="self-start flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={12} />
        返回选择
      </button>
      <h3 className="text-base font-semibold">新建项目</h3>

      <label className="text-sm">
        <div className="text-ink-700 mb-1">项目名称</div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：AI 投顾"
          autoFocus
          maxLength={128}
          required
        />
      </label>

      <fieldset>
        <legend className="text-sm text-ink-700 mb-1">可见性</legend>
        <div className="flex gap-3 text-sm">
          {[
            { v: "private", label: "私有（仅我）" },
            { v: "team", label: "团队（所有人可见）" },
          ].map((opt) => (
            <label key={opt.v} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="visibility"
                value={opt.v}
                checked={visibility === (opt.v as "private" | "team")}
                onChange={() => setVisibility(opt.v as "private" | "team")}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="text-sm">
        <div className="text-ink-700 mb-1">方案名称</div>
        <Input
          value={firstVersionName}
          onChange={(e) => setFirstVersionName(e.target.value)}
          placeholder="如：AI 选好股 4.0"
          maxLength={64}
          required
        />
      </label>

      <div className="flex gap-2 mt-auto pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary" disabled={pending} className="flex-1">
          {pending ? "创建中..." : "创建并进入"}
        </Button>
      </div>
    </form>
  );
}

function CreateVersionForm({
  projectId,
  projectName,
  onCancel,
  onCreated,
}: {
  projectId: string;
  projectName: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      await versionsApi.create(projectId, { name: name.trim() });
      toast.success(`方案「${name.trim()}」已建`);
      setName("");
      await onCreated();
    } catch {
      // toast already
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`在 ${projectName} 下新建方案名...`}
        autoFocus
        maxLength={64}
        required
        className="flex-1 min-w-0"
      />
      <Button type="submit" size="sm" disabled={pending} variant="primary" className="shrink-0">
        {pending ? "..." : "创建"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="shrink-0">
        取消
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import useSWR from "swr";
import { Copy, ExternalLink, Lock, LockOpen, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShareDialog } from "@/components/share-dialog";
import { DeleteProjectModal } from "@/components/delete-project-modal";
import { VisibilityChip } from "@/components/workbench/tab-panel";
import { formatRelative } from "@/components/workbench/format";
import { apiFetch, reposApi, type ShareRow } from "@/lib/api-client";
import { copyText } from "@/lib/copy-text";
import { RepoChip } from "./repo-chip";

export interface RepoProjectVersion {
  key: string;
  number: string | null;
  name: string | null;
  sealedAt: string | null;
  online: boolean;
}

interface Props {
  project: { id: string; name: string; visibility: "private" | "team" };
  /** 仓库的系统方案：项目级分享链接挂在它上面 */
  systemVersionId: string;
  /** 项目简介（G-canvas 推送时带上）；没有为 null */
  summary: string | null;
  canManage: boolean;
  pushedAt: string | null;
  pushedBy: string | null;
  /** 访客可见的版本（未撤回），新的在前 */
  versions: RepoProjectVersion[];
  draft: { pushedAt: string } | null;
}

/**
 * G-canvas 仓库项目的主站页：看推送情况、拿访客链接、在查看器中打开、删除项目。
 * 版本内容与版本信息只由 G-canvas 推送维护，这里只读。
 */
export function RepoProjectView({
  project,
  systemVersionId,
  summary,
  canManage,
  pushedAt,
  pushedBy,
  versions,
  draft,
}: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const onOpenViewer = async () => {
    setOpening(true);
    try {
      const { url } = await reposApi.previewToken(project.id);
      window.open(url, "_blank", "noopener");
    } catch {
      // toast 已自动
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="max-w-[880px] mx-auto px-8 py-10 space-y-6" data-testid="repo-project-page">
      <section className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[20px] font-semibold tracking-tight text-ink-900 truncate">{project.name}</h1>
            <RepoChip />
            <VisibilityChip visibility={project.visibility} />
          </div>
          {summary ? (
            <p
              className="text-[13px] text-ink-700 mt-1.5 whitespace-pre-wrap break-words"
              data-testid="repo-summary"
            >
              {summary}
            </p>
          ) : null}
          <p className="text-[13px] text-ink-500 mt-1.5 tabular-nums" data-testid="repo-push-meta">
            内容由 G-canvas 推送维护
            <span className="text-ink-300 mx-1.5">·</span>
            {pushedAt ? (
              <>
                上次推送 <span suppressHydrationWarning>{formatRelative(pushedAt)}</span>
                {pushedBy ? (
                  <>
                    <span className="text-ink-300 mx-1.5">·</span>
                    {pushedBy}
                  </>
                ) : null}
              </>
            ) : (
              "还没有推送过"
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="primary"
            size="md"
            onClick={onOpenViewer}
            disabled={opening}
            data-testid="repo-open-viewer"
          >
            <ExternalLink size={13} strokeWidth={2.25} />
            <span>在查看器中打开</span>
          </Button>
          {canManage ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setShareOpen(true)}
                data-testid="repo-share-button"
              >
                <Share2 size={13} strokeWidth={2.25} />
                <span>分享</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="项目操作" data-testid="repo-project-menu">
                    <MoreHorizontal size={14} strokeWidth={2.25} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    destructive
                    className="gap-2"
                    onSelect={() => setDeleteOpen(true)}
                    data-testid="repo-project-delete"
                  >
                    <Trash2 size={13} />
                    删除项目
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>
      </section>

      {canManage ? (
        <VisitorLinkCard systemVersionId={systemVersionId} onManage={() => setShareOpen(true)} />
      ) : null}

      <VersionsCard versions={versions} draft={draft} />

      {canManage ? (
        <>
          <ShareDialog
            open={shareOpen}
            version={{ id: systemVersionId, name: project.name }}
            description="访客打开链接直接进入查看器，默认看线上版本，可切换查看所有已推送的版本"
            onClose={() => setShareOpen(false)}
          />
          <DeleteProjectModal
            open={deleteOpen}
            target={{ id: project.id, name: project.name }}
            isRepo
            redirectTo="/projects"
            onClose={() => setDeleteOpen(false)}
          />
        </>
      ) : null}
    </main>
  );
}

function VisitorLinkCard({ systemVersionId, onManage }: { systemVersionId: string; onManage: () => void }) {
  // 与分享弹窗同一个缓存键：弹窗里建 / 撤链接、改密码后这里自动刷新
  const { data, isLoading } = useSWR<{ share: ShareRow | null }>(
    `/api/v1/versions/${systemVersionId}/shares`,
    (url: string) => apiFetch<{ share: ShareRow | null }>(url, undefined, { silent: true }),
    { dedupingInterval: 30_000 },
  );
  const share = data?.share ?? null;
  const url = share ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${share.shareId}` : "";

  const onCopy = async () => {
    if (await copyText(url)) toast.success("已复制访客链接");
    else toast.error("复制失败，请手动选择");
  };

  return (
    <section className="border border-ink-200 rounded-[var(--radius-lg)] p-5" data-testid="repo-visitor-link">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-semibold text-ink-900">访客链接</h2>
        <span className="text-[12px] text-ink-500">在链接后加 ?v=版本号 可直达某一版</span>
      </div>
      {isLoading ? (
        <div className="text-[13px] text-ink-500">加载中...</div>
      ) : share ? (
        <div className="space-y-2.5">
          <div className="flex items-stretch gap-1.5">
            <Input
              readOnly
              value={url}
              data-testid="repo-visitor-url"
              className="flex-1 font-mono text-[11px] tracking-tight"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="secondary" size="md" onClick={onCopy} aria-label="复制访客链接" className="px-3">
              <Copy size={13} strokeWidth={2.25} />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[12px] text-ink-600" data-has-password={share.hasPassword}>
              {share.hasPassword ? (
                <Lock size={12} strokeWidth={2.25} className="text-ink-500" />
              ) : (
                <LockOpen size={12} strokeWidth={2.25} className="text-ink-500" />
              )}
              {share.hasPassword ? "已设访问密码" : "无密码，拿到链接的人都能查看"}
            </span>
            <Button variant="ghost" size="sm" onClick={onManage}>
              管理链接与密码
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-500">还没有访客链接</span>
          <Button variant="secondary" size="md" onClick={onManage} data-testid="repo-create-share">
            创建访客链接
          </Button>
        </div>
      )}
    </section>
  );
}

function VersionsCard({
  versions,
  draft,
}: {
  versions: RepoProjectVersion[];
  draft: { pushedAt: string } | null;
}) {
  const empty = versions.length === 0 && !draft;
  return (
    <section className="border border-ink-200 rounded-[var(--radius-lg)] p-5" data-testid="repo-versions">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-semibold text-ink-900">
          版本 <span className="text-ink-500 font-normal tabular-nums">{versions.length}</span>
        </h2>
        <span className="text-[12px] text-ink-500">版本信息以 G-canvas 为准，在 G-canvas 里修改后重新推送</span>
      </div>
      {empty ? (
        <div className="text-[13px] text-ink-500 py-4 text-center">还没有推送任何版本</div>
      ) : (
        <ul className="divide-y divide-ink-150">
          {draft ? (
            <li className="flex items-center gap-3 py-2 text-[13px]">
              <span className="w-24 shrink-0 text-ink-500">草稿</span>
              <span className="flex-1 min-w-0 text-ink-500 truncate">未封版的当前内容</span>
              <span className="shrink-0 text-[12px] text-ink-400 tabular-nums" suppressHydrationWarning>
                推送于 {formatRelative(draft.pushedAt)}
              </span>
            </li>
          ) : null}
          {versions.map((v) => (
            <li key={v.key} className="flex items-center gap-3 py-2 text-[13px]" data-testid="repo-version-row">
              <span className="w-24 shrink-0 font-mono text-[12px] text-ink-900 truncate">{v.number ?? "—"}</span>
              <span className="flex-1 min-w-0 text-ink-700 truncate">
                {v.name ?? ""}
                {v.online ? (
                  <span className="ml-2 inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--radius-sm)] text-success bg-success-bg">
                    线上
                  </span>
                ) : null}
              </span>
              {v.sealedAt ? (
                <span className="shrink-0 text-[12px] text-ink-400 tabular-nums" suppressHydrationWarning>
                  封版于 {formatRelative(v.sealedAt)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

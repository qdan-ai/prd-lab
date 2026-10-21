"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatRelative } from "@/components/workbench/format";
import { apiFetch, type ApiError } from "@/lib/api-client";
import { pendingText, removeConfirmText } from "./remove-text";

type Role = "lead" | "admin" | "member";

interface Member {
  user: { id: string; name: string; removed: boolean };
  role: Role;
  addedAt: string;
}

interface Progress {
  user: { id: string };
  line: string;
  pushedAt: string;
  changed: { items: string[]; total: number };
}

const ROLE_LABEL: Record<Role, string> = { lead: "负责人", admin: "管理员", member: "成员" };

const TEAM_FORMAT = "1";

/** 把团队接口的错误翻译成用户能懂的提示。 */
function errorText(e: unknown): string {
  const code = (e as Partial<ApiError> | null)?.error_code;
  switch (code) {
    case "user_not_found":
      return "找不到这个账号，请对方先登录一次 PRD-Lab";
    case "team_not_ready":
      return "先在 G-canvas 里开启团队协作";
    case "already_member":
      return "这个账号已经在团队里了";
    case "lead_fixed":
      return "负责人的角色不能修改，也不能被移除";
    case "forbidden_role":
      return "只有负责人可以管理成员";
    default:
      return "操作没有成功，请稍后再试";
  }
}

interface Props {
  project: { id: string; name: string };
  /** 当前登录者在团队里的角色 */
  myRole: Role;
  /** G-canvas 里的开启是否已完成 */
  ready: boolean;
}

/** 成员页的标题区：返回项目 + 「项目名 · 成员」 */
function MembersHeading({ project }: { project: { id: string; name: string } }) {
  return (
    <section>
      <Link
        href={`/projects/${project.id}`}
        className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft size={12} strokeWidth={2.25} />
        返回项目
      </Link>
      <h1 className="text-[20px] font-semibold tracking-tight text-ink-900 mt-2 truncate">
        {project.name} <span className="text-ink-500 font-normal">· 成员</span>
      </h1>
    </section>
  );
}

/** 从没开启过团队协作的项目，负责人打开成员页时看到的提示。 */
export function TeamNotOpenedView({ project }: { project: { id: string; name: string } }) {
  return (
    <main className="max-w-[880px] mx-auto px-8 py-10 space-y-6" data-testid="team-members-page">
      <MembersHeading project={project} />
      <section
        className="border border-ink-200 rounded-[var(--radius-lg)] p-5 text-[13px] text-ink-700"
        data-testid="team-not-opened"
      >
        这个项目还没有开启团队协作，请在 G-canvas 里开启。
      </section>
    </main>
  );
}

/** 项目页「成员」：成员表、添加 / 改角色 / 移除（负责人），以及每人的进度摘要。 */
export function TeamMembersView({ project, myRole, ready }: Props) {
  const isLead = myRole === "lead";
  const membersKey = `/api/v1/repos/${project.id}/team/members`;
  const stateKey = `/api/v1/repos/${project.id}/team/state`;

  const { data: membersData, mutate: mutateMembers } = useSWR<{ members: Member[] }>(
    membersKey,
    (url: string) => apiFetch<{ members: Member[] }>(url, undefined, { silent: true }),
  );
  const { data: stateData, mutate: mutateState } = useSWR<{ progress: Progress[] }>(
    ready ? stateKey : null,
    (url: string) =>
      apiFetch<{ progress: Progress[] }>(url, { headers: { "X-Gcanvas-Team-Format": TEAM_FORMAT } }, { silent: true }),
    { refreshInterval: 30_000 },
  );

  const members = membersData?.members ?? [];
  const progressByUser = new Map((stateData?.progress ?? []).map((p) => [p.user.id, p]));

  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const refreshAll = async () => {
    await Promise.all([mutateMembers(), ready ? mutateState() : undefined]);
  };

  const onAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    try {
      await apiFetch(membersKey, { method: "POST", body: JSON.stringify({ name: trimmed, role }) }, { silent: true });
      toast.success(`已添加 ${trimmed}`);
      setName("");
      await refreshAll();
    } catch (e) {
      setAddError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  const onChangeRole = async (m: Member, next: "admin" | "member") => {
    if (m.role === next) return;
    try {
      await apiFetch(
        `${membersKey}/${m.user.id}`,
        { method: "PATCH", body: JSON.stringify({ role: next }) },
        { silent: true },
      );
      toast.success(`${m.user.name} 已改为${ROLE_LABEL[next]}`);
    } catch (e) {
      toast.error(errorText(e));
    }
    await refreshAll();
  };

  const onConfirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`${membersKey}/${removing.user.id}`, { method: "DELETE" }, { silent: true });
      toast.success(`已移除 ${removing.user.name}`);
      setRemoving(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRemoveBusy(false);
    }
    await refreshAll();
  };

  return (
    <main className="max-w-[880px] mx-auto px-8 py-10 space-y-6" data-testid="team-members-page">
      <MembersHeading project={project} />

      {!ready ? (
        <section
          className="border border-ink-200 rounded-[var(--radius-lg)] p-5 text-[13px] text-ink-700"
          data-testid="team-not-ready"
        >
          先在 G-canvas 里开启团队协作。开启完成后，才能在这里添加成员。
        </section>
      ) : null}

      {isLead ? (
        <section className="border border-ink-200 rounded-[var(--radius-lg)] p-5" data-testid="team-add-member">
          <h2 className="text-[14px] font-semibold text-ink-900 mb-3">添加成员</h2>
          <form
            className="flex items-stretch gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void onAdd();
            }}
          >
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setAddError(null);
              }}
              placeholder="输入对方的 PRD-Lab 账号名"
              aria-label="账号名"
              data-testid="team-add-name"
              className="flex-1"
              disabled={!ready || adding}
            />
            <RoleSelect
              value={role}
              onChange={setRole}
              disabled={!ready || adding}
              testId="team-add-role"
              label="角色"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!ready || adding || !name.trim()}
              data-testid="team-add-submit"
            >
              {adding ? "添加中..." : "添加"}
            </Button>
          </form>
          {addError ? (
            <p className="text-[12px] text-[color:var(--color-danger)] mt-2" role="alert" data-testid="team-add-error">
              {addError}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="border border-ink-200 rounded-[var(--radius-lg)] p-5" data-testid="team-member-list">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-[14px] font-semibold text-ink-900">
            成员 <span className="text-ink-500 font-normal tabular-nums">{members.length}</span>
          </h2>
          <span className="text-[12px] text-ink-500">进度来自成员在 G-canvas 里的最近一次刷新</span>
        </div>
        {members.length === 0 ? (
          <div className="text-[13px] text-ink-500 py-4 text-center">加载中...</div>
        ) : (
          <ul className="divide-y divide-ink-150">
            {members.map((m) => (
              <MemberRow
                key={m.user.id}
                member={m}
                progress={progressByUser.get(m.user.id) ?? null}
                canEdit={isLead && m.role !== "lead"}
                ready={ready}
                onChangeRole={(next) => onChangeRole(m, next)}
                onRemove={() => setRemoving(m)}
              />
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!removing} onOpenChange={(o) => !o && !removeBusy && setRemoving(null)}>
        <DialogContent className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col" data-testid="team-remove-dialog">
          <div className="px-6 pt-6 pb-5">
            <DialogTitle className="text-[16px]">移除成员 {removing?.user.name}</DialogTitle>
            <DialogDescription className="text-[13px] text-ink-500 mt-1">
              {removing ? removeConfirmText(removing.user.name, progressByUser.get(removing.user.id)?.changed.total ?? null) : null}
            </DialogDescription>
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
            <Button variant="ghost" size="md" onClick={() => setRemoving(null)} disabled={removeBusy}>
              取消
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={onConfirmRemove}
              disabled={removeBusy}
              data-testid="team-remove-confirm"
              className="min-w-[72px]"
            >
              {removeBusy ? "移除中..." : "移除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  testId,
  label,
}: {
  value: "admin" | "member";
  onChange: (v: "admin" | "member") => void;
  disabled?: boolean;
  testId: string;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as "admin" | "member")}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className="h-8 px-2 text-sm rounded-[var(--radius-md)] bg-white text-ink-900 border border-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <option value="member">成员</option>
      <option value="admin">管理员</option>
    </select>
  );
}

function MemberRow({
  member,
  progress,
  canEdit,
  ready,
  onChangeRole,
  onRemove,
}: {
  member: Member;
  progress: Progress | null;
  canEdit: boolean;
  ready: boolean;
  onChangeRole: (r: "admin" | "member") => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-3 py-3 text-[13px]" data-testid="team-member-row" data-user={member.user.name}>
      <span className="w-28 shrink-0 font-medium text-ink-900 truncate pt-1">{member.user.name}</span>
      <span className="w-24 shrink-0">
        {canEdit && member.role !== "lead" ? (
          <RoleSelect
            value={member.role as "admin" | "member"}
            onChange={onChangeRole}
            testId="team-row-role"
            label={`${member.user.name}的角色`}
          />
        ) : (
          <span className="inline-block pt-1 text-ink-700" data-testid="team-row-role-text">
            {ROLE_LABEL[member.role]}
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0 pt-1" data-testid="team-row-progress">
        <ProgressCell progress={progress} ready={ready} />
      </div>
      {canEdit ? (
        <Button variant="ghost" size="sm" onClick={onRemove} data-testid="team-row-remove">
          移除
        </Button>
      ) : (
        <span className="w-[52px] shrink-0" />
      )}
    </li>
  );
}

function ProgressCell({ progress, ready }: { progress: Progress | null; ready: boolean }) {
  if (!ready || !progress) return <span className="text-ink-400">还没有刷新过</span>;
  const line = progress.line === "main" ? "主线" : "补丁线";
  const { items, total } = progress.changed;
  return (
    <div className="space-y-0.5">
      <div className="text-ink-700 tabular-nums">
        {line}
        <span className="text-ink-300 mx-1.5">·</span>
        <span suppressHydrationWarning>{formatRelative(progress.pushedAt)}刷新</span>
        <span className="text-ink-300 mx-1.5">·</span>
        {pendingText(total)}
      </div>
      {total > 0 ? (
        <div className="text-[12px] text-ink-500 truncate" title={items.join("、")}>
          {items.slice(0, 5).join("、")}
          {total > 5 ? " 等" : ""}
        </div>
      ) : null}
    </div>
  );
}

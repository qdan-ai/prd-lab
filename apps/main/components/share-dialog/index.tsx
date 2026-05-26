"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Copy, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, sharesApi, type ShareRow } from "@/lib/api-client";

interface Props {
  open: boolean;
  snapshot: { id: string; seqNo: number; versionLabel: string | null } | null;
  onClose: () => void;
}

type View = "main" | "reset_password" | "revoke_confirm";

/**
 * 分享对话框（S9：删 allow_comment 字段）。绑 snapshot 而非 version。
 * `snapshot` 为 null 时 dialog 不渲染。
 */
export function ShareDialog({ open, snapshot, onClose }: Props) {
  const sid = snapshot?.id ?? "";
  const label = snapshot
    ? snapshot.versionLabel
      ? `${snapshot.versionLabel}（v${snapshot.seqNo}）`
      : `v${snapshot.seqNo}`
    : "";
  const [view, setView] = useState<View>("main");
  const [createPassword, setCreatePassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // 仅在本次会话刚创建 / 刚重置时持有明文密码，用于"复制链接+密码"。
  // dialog 关闭后清空。已存在的 share 重新打开 dialog 无法回填密码。
  const [sessionPassword, setSessionPassword] = useState("");

  const { data, isLoading } = useSWR<{ share: ShareRow | null }>(
    open && sid ? `/api/v1/snapshots/${sid}/shares` : null,
    (url: string) => apiFetch<{ share: ShareRow | null }>(url, undefined, { silent: true }),
    { dedupingInterval: 30_000 },
  );

  useEffect(() => {
    if (!open) {
      setView("main");
      setCreatePassword("");
      setResetPassword("");
      setShowPassword(false);
      setBusy(false);
      setSessionPassword("");
    }
  }, [open]);

  const share = data?.share ?? null;
  const shareUrl = share ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${share.shareId}` : "";

  const onCreate = async () => {
    if (createPassword.length < 6) {
      toast.error("密码至少 6 个字符");
      return;
    }
    setBusy(true);
    try {
      await sharesApi.create(sid, { password: createPassword });
      setSessionPassword(createPassword);
      toast.success("已创建分享链接");
    } catch {
      // toast 已自动
    } finally {
      setBusy(false);
    }
  };

  const onResetPassword = async () => {
    if (!share) return;
    if (resetPassword.length < 6) {
      toast.error("新密码至少 6 个字符");
      return;
    }
    setBusy(true);
    try {
      await sharesApi.update(share.shareId, sid, { password: resetPassword });
      setSessionPassword(resetPassword);
      toast.success("密码已重置；访客旧 cookie 立即失效");
      setView("main");
      setResetPassword("");
    } catch {
      // toast 已自动
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async () => {
    if (!share) return;
    setBusy(true);
    try {
      await sharesApi.revoke(share.shareId, sid);
      toast.success("分享已撤销");
      setView("main");
    } catch {
      // toast 已自动
    } finally {
      setBusy(false);
    }
  };

  const onCopyUrl = async () => {
    if (!shareUrl) return;
    const payload = sessionPassword
      ? `分享链接：${shareUrl}\n访问密码：${sessionPassword}`
      : shareUrl;
    try {
      await navigator.clipboard.writeText(payload);
      toast.success(sessionPassword ? "已复制链接和密码" : "已复制分享链接");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col"
        data-testid="share-dialog"
      >
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">
            {view === "reset_password"
              ? "重置分享密码"
              : view === "revoke_confirm"
                ? "撤销分享链接"
                : `分享 ${label}`}
          </DialogTitle>
          <div className="text-[13px] text-ink-500 mt-1">
            {view === "reset_password"
              ? "重置后所有访客的旧 cookie 立即失效，需要重新输入新密码登入"
              : view === "revoke_confirm"
                ? "撤销后旧 URL 永久失效，新建分享会生成新 URL"
                : "外部访客访问该链接时只能看到这个版本"}
          </div>
        </div>

        <div className="px-6 py-5">
          {isLoading ? (
            <div className="text-[13px] text-ink-500">加载中...</div>
          ) : view === "reset_password" && share ? (
            <ResetPasswordForm
              value={resetPassword}
              onChange={setResetPassword}
              show={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              onSubmit={onResetPassword}
              busy={busy}
            />
          ) : view === "revoke_confirm" && share ? (
            <RevokeConfirmBody shareUrl={shareUrl} />
          ) : share ? (
            <ShareActiveBody
              shareUrl={shareUrl}
              onCopyUrl={onCopyUrl}
              onResetClick={() => setView("reset_password")}
              onRevokeClick={() => setView("revoke_confirm")}
              busy={busy}
            />
          ) : (
            <ShareCreateForm
              password={createPassword}
              onPasswordChange={setCreatePassword}
              show={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              onSubmit={onCreate}
              busy={busy}
            />
          )}
        </div>

        {view === "reset_password" || view === "revoke_confirm" ? (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
            <Button variant="ghost" size="md" onClick={() => setView("main")} disabled={busy}>
              取消
            </Button>
            {view === "reset_password" ? (
              <Button
                variant="primary"
                size="md"
                onClick={onResetPassword}
                disabled={busy || resetPassword.length < 6}
                data-testid="share-reset-confirm"
                className="min-w-[88px]"
              >
                {busy ? "重置中..." : "确认重置"}
              </Button>
            ) : (
              <Button
                variant="danger"
                size="md"
                onClick={onRevoke}
                disabled={busy}
                data-testid="share-revoke-confirm"
                className="min-w-[88px]"
              >
                {busy ? "撤销中..." : "确认撤销"}
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ShareCreateForm({
  password,
  onPasswordChange,
  show,
  onToggleShow,
  onSubmit,
  busy,
}: {
  password: string;
  onPasswordChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-[12px] text-ink-700 font-medium block mb-1.5">
          访问密码（至少 6 字符）
        </label>
        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="设一个外部协作方易记的密码"
            data-testid="share-create-password"
            autoFocus
            className="pr-9"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-900"
            aria-label={show ? "隐藏密码" : "显示密码"}
          >
            {show ? <EyeOff size={14} strokeWidth={2.25} /> : <Eye size={14} strokeWidth={2.25} />}
          </button>
        </div>
      </div>

      <Button
        variant="primary"
        size="md"
        onClick={onSubmit}
        disabled={busy || password.length < 6}
        data-testid="share-create-submit"
        className="w-full"
      >
        {busy ? "创建中..." : "创建分享链接"}
      </Button>
    </div>
  );
}

function ShareActiveBody({
  shareUrl,
  onCopyUrl,
  onResetClick,
  onRevokeClick,
  busy,
}: {
  shareUrl: string;
  onCopyUrl: () => void;
  onResetClick: () => void;
  onRevokeClick: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-[12px] text-ink-700 font-medium block mb-1.5">分享 URL</label>
        <div className="flex items-stretch gap-1.5">
          <Input
            readOnly
            value={shareUrl}
            data-testid="share-url"
            className="flex-1 font-mono text-[11px] tracking-tight"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            variant="secondary"
            size="md"
            onClick={onCopyUrl}
            aria-label="复制 URL"
            data-testid="share-copy"
            className="px-3"
          >
            <Copy size={13} strokeWidth={2.25} />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="secondary"
          size="md"
          onClick={onResetClick}
          disabled={busy}
          data-testid="share-reset-trigger"
          className="flex-1"
        >
          <KeyRound size={13} strokeWidth={2.25} />
          <span>重置密码</span>
        </Button>
        <Button
          variant="danger"
          size="md"
          onClick={onRevokeClick}
          disabled={busy}
          data-testid="share-revoke-trigger"
          className="flex-1"
        >
          <Trash2 size={13} strokeWidth={2.25} />
          <span>撤销分享</span>
        </Button>
      </div>
    </div>
  );
}

function ResetPasswordForm({
  value,
  onChange,
  show,
  onToggleShow,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="text-[12px] text-ink-700 font-medium block">新密码（至少 6 字符）</label>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          autoFocus
          disabled={busy}
          data-testid="share-reset-password"
          className="pr-9"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-900"
          aria-label={show ? "隐藏密码" : "显示密码"}
        >
          {show ? <EyeOff size={14} strokeWidth={2.25} /> : <Eye size={14} strokeWidth={2.25} />}
        </button>
      </div>
      <div className="text-[11px] text-ink-500 leading-[1.55]">
        重置后所有访客需要重新登入。旧 cookie 立即失效不可恢复。
      </div>
    </div>
  );
}

function RevokeConfirmBody({ shareUrl }: { shareUrl: string }) {
  return (
    <div className="space-y-2.5">
      <div className="text-[13px] text-ink-900 leading-[1.55]">
        确认撤销分享链接？
      </div>
      <div className="px-3 py-2 bg-ink-100 rounded-[var(--radius-sm)] font-mono text-[11px] text-ink-700 break-all">
        {shareUrl}
      </div>
      <div className="text-[12px] text-ink-500 leading-[1.55]">
        所有外部访客访问该 URL 立即返回 410。如需重新分享，撤销后可创建新链接（新 URL）。
      </div>
    </div>
  );
}

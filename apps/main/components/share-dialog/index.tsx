"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Copy, Eye, EyeOff, KeyRound, Lock, LockOpen, Trash2 } from "lucide-react";
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

type View = "main" | "set_password" | "revoke_confirm";

const NO_PASSWORD_HINT = "任何拿到链接的人都能查看，请勿公开转发。";

/**
 * 分享对话框。绑 snapshot 而非 version。密码可选（默认无）：
 *   - 创建态：开关式，默认无密码，打开「设置访问密码」开关才填密码。
 *   - 已存在态：按 share.hasPassword 分支为「无密码 / 有密码」两套管理操作。
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
  const [withPassword, setWithPassword] = useState(false);
  const [createPassword, setCreatePassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // 仅在本次会话刚创建 / 刚设置密码时持有明文密码，用于"复制链接+密码"。
  // dialog 关闭后清空；移除密码后也清空（否则会复制出已失效旧密码误导访客）。
  const [sessionPassword, setSessionPassword] = useState("");

  const { data, isLoading, mutate } = useSWR<{ share: ShareRow | null }>(
    open && sid ? `/api/v1/snapshots/${sid}/shares` : null,
    (url: string) => apiFetch<{ share: ShareRow | null }>(url, undefined, { silent: true }),
    { dedupingInterval: 30_000 },
  );

  useEffect(() => {
    if (!open) {
      setView("main");
      setWithPassword(false);
      setCreatePassword("");
      setNewPassword("");
      setShowPassword(false);
      setBusy(false);
      setSessionPassword("");
    }
  }, [open]);

  const share = data?.share ?? null;
  const shareUrl = share
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${share.shareId}`
    : "";

  const onCreate = async () => {
    if (withPassword && (createPassword.length < 6 || createPassword.length > 200)) {
      toast.error("密码长度需为 6–200 个字符");
      return;
    }
    setBusy(true);
    try {
      await sharesApi.create(sid, withPassword ? { password: createPassword } : {});
      setSessionPassword(withPassword ? createPassword : "");
      toast.success("已创建分享链接");
    } catch {
      // toast 已自动
    } finally {
      setBusy(false);
    }
  };

  // 设置密码（无→有）/ 修改密码（有→有'）共用，均走 action=set。
  const onSetPassword = async () => {
    if (!share) return;
    if (newPassword.length < 6 || newPassword.length > 200) {
      toast.error("密码长度需为 6–200 个字符");
      return;
    }
    setBusy(true);
    try {
      const { share: updated } = await sharesApi.update(share.shareId, sid, {
        action: "set",
        password: newPassword,
      });
      // 用 PATCH 返回的权威 share 同步刷新 SWR 缓存，避免「hasPassword 异步重验滞后 →
      // 刚设密码立即点复制只带 URL 不带密码」的时序窗口。
      void mutate({ share: updated }, { revalidate: false });
      setSessionPassword(newPassword);
      toast.success(
        share.hasPassword ? "密码已修改；访客旧 cookie 立即失效" : "已设置访问密码",
      );
      setView("main");
      setNewPassword("");
    } catch {
      // toast 已自动
    } finally {
      setBusy(false);
    }
  };

  const onRemovePassword = async () => {
    if (!share) return;
    setBusy(true);
    try {
      const { share: updated } = await sharesApi.update(share.shareId, sid, { action: "remove" });
      // 对称：用权威 share 同步置 hasPassword=false，并清空 sessionPassword（明文已失效，复制只带链接）。
      void mutate({ share: updated }, { revalidate: false });
      setSessionPassword("");
      toast.success("已移除密码；正在查看的访客不受影响");
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
    // 以 hasPassword 门控，避免复制出"链接 + 已失效旧密码"。
    const includePassword = !!share?.hasPassword && !!sessionPassword;
    const payload = includePassword
      ? `分享链接：${shareUrl}\n访问密码：${sessionPassword}`
      : shareUrl;
    try {
      await navigator.clipboard.writeText(payload);
      toast.success(includePassword ? "已复制链接和密码" : "已复制分享链接");
    } catch {
      toast.error("复制失败，请手动选择");
    }
  };

  const subtitle =
    view === "set_password"
      ? share?.hasPassword
        ? "修改后所有访客的旧 cookie 立即失效，需要重新输入新密码登入"
        : "设置后访客需先输入密码才能查看该链接"
      : view === "revoke_confirm"
        ? "撤销后旧 URL 永久失效，新建分享会生成新 URL"
        : "外部访客访问该链接时只能看到这个版本";

  const dialogTitle =
    view === "set_password"
      ? share?.hasPassword
        ? "修改分享密码"
        : "设置访问密码"
      : view === "revoke_confirm"
        ? "撤销分享链接"
        : `分享 ${label}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="w-[480px] max-w-[calc(100vw-32px)] p-0 flex flex-col"
        data-testid="share-dialog"
      >
        <div className="px-6 pt-6 pb-5 border-b border-ink-150">
          <DialogTitle className="text-[16px]">{dialogTitle}</DialogTitle>
          <div className="text-[13px] text-ink-500 mt-1">{subtitle}</div>
        </div>

        <div className="px-6 py-5">
          {isLoading ? (
            <div className="text-[13px] text-ink-500">加载中...</div>
          ) : view === "set_password" && share ? (
            <SetPasswordForm
              value={newPassword}
              onChange={setNewPassword}
              show={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              onSubmit={onSetPassword}
              busy={busy}
              isModify={share.hasPassword}
            />
          ) : view === "revoke_confirm" && share ? (
            <RevokeConfirmBody shareUrl={shareUrl} />
          ) : share ? (
            <ShareActiveBody
              share={share}
              shareUrl={shareUrl}
              onCopyUrl={onCopyUrl}
              onSetPasswordClick={() => {
                setNewPassword("");
                setView("set_password");
              }}
              onRemovePassword={onRemovePassword}
              onRevokeClick={() => setView("revoke_confirm")}
              busy={busy}
            />
          ) : (
            <ShareCreateForm
              withPassword={withPassword}
              onToggleWithPassword={() => setWithPassword((v) => !v)}
              password={createPassword}
              onPasswordChange={setCreatePassword}
              show={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              onSubmit={onCreate}
              busy={busy}
            />
          )}
        </div>

        {view === "set_password" || view === "revoke_confirm" ? (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-ink-150 bg-ink-50/40 rounded-b-[var(--radius-lg)]">
            <Button variant="ghost" size="md" onClick={() => setView("main")} disabled={busy}>
              取消
            </Button>
            {view === "set_password" ? (
              <Button
                variant="primary"
                size="md"
                onClick={onSetPassword}
                disabled={busy || newPassword.length < 6 || newPassword.length > 200}
                data-testid="share-set-password-confirm"
                className="min-w-[88px]"
              >
                {busy ? "提交中..." : share?.hasPassword ? "确认修改" : "确认设置"}
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
  withPassword,
  onToggleWithPassword,
  password,
  onPasswordChange,
  show,
  onToggleShow,
  onSubmit,
  busy,
}: {
  withPassword: boolean;
  onToggleWithPassword: () => void;
  password: string;
  onPasswordChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-ink-900 font-medium">设置访问密码</div>
          <div className="text-[12px] text-ink-500 leading-[1.55] mt-0.5">
            打开后访客需先输入密码才能查看；关闭则任何拿到链接的人都能直接查看。
          </div>
        </div>
        <ToggleSwitch
          checked={withPassword}
          onToggle={onToggleWithPassword}
          disabled={busy}
          label="设置访问密码"
          testId="share-create-password-toggle"
        />
      </div>

      {withPassword ? (
        <div>
          <label className="text-[12px] text-ink-700 font-medium block mb-1.5">
            访问密码（6–200 字符）
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
      ) : (
        <div
          className="text-[12px] text-ink-500 leading-[1.55] px-3 py-2 bg-ink-50 rounded-[var(--radius-sm)]"
          data-testid="share-create-no-password-hint"
        >
          {NO_PASSWORD_HINT}
        </div>
      )}

      <Button
        variant="primary"
        size="md"
        onClick={onSubmit}
        disabled={busy || (withPassword && (password.length < 6 || password.length > 200))}
        data-testid="share-create-submit"
        className="w-full"
      >
        {busy ? "创建中..." : "创建分享链接"}
      </Button>
    </div>
  );
}

function ShareActiveBody({
  share,
  shareUrl,
  onCopyUrl,
  onSetPasswordClick,
  onRemovePassword,
  onRevokeClick,
  busy,
}: {
  share: ShareRow;
  shareUrl: string;
  onCopyUrl: () => void;
  onSetPasswordClick: () => void;
  onRemovePassword: () => void;
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

      {share.hasPassword ? (
        <div
          className="flex items-center gap-2 text-[12px] text-ink-700 px-3 py-2 bg-ink-50 rounded-[var(--radius-sm)]"
          data-testid="share-password-status"
          data-has-password="true"
        >
          <Lock size={13} strokeWidth={2.25} className="shrink-0 text-ink-500" />
          <span>已设置访问密码，访客需输入密码后查看。</span>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 text-[12px] text-ink-700 px-3 py-2 bg-ink-50 rounded-[var(--radius-sm)]"
          data-testid="share-password-status"
          data-has-password="false"
        >
          <LockOpen size={13} strokeWidth={2.25} className="shrink-0 text-ink-500 mt-0.5" />
          <span className="leading-[1.55]">
            当前无密码，任何人可看。{NO_PASSWORD_HINT}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="secondary"
          size="md"
          onClick={onSetPasswordClick}
          disabled={busy}
          data-testid="share-set-password-trigger"
          className="flex-1"
        >
          <KeyRound size={13} strokeWidth={2.25} />
          <span>{share.hasPassword ? "修改密码" : "设置密码"}</span>
        </Button>
        {share.hasPassword ? (
          <Button
            variant="secondary"
            size="md"
            onClick={onRemovePassword}
            disabled={busy}
            data-testid="share-remove-password-trigger"
            className="flex-1"
          >
            <LockOpen size={13} strokeWidth={2.25} />
            <span>{busy ? "移除中..." : "移除密码"}</span>
          </Button>
        ) : null}
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

function SetPasswordForm({
  value,
  onChange,
  show,
  onToggleShow,
  onSubmit,
  busy,
  isModify,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  onSubmit: () => void;
  busy: boolean;
  isModify: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="text-[12px] text-ink-700 font-medium block">
        {isModify ? "新密码（6–200 字符）" : "访问密码（6–200 字符）"}
      </label>
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
          data-testid="share-set-password-input"
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
        {isModify
          ? "修改后所有访客需要重新登入。旧 cookie 立即失效不可恢复。"
          : "设置后访客需先输入密码才能查看；正在查看的访客会被要求重新输入。"}
      </div>
    </div>
  );
}

function RevokeConfirmBody({ shareUrl }: { shareUrl: string }) {
  return (
    <div className="space-y-2.5">
      <div className="text-[13px] text-ink-900 leading-[1.55]">确认撤销分享链接？</div>
      <div className="px-3 py-2 bg-ink-100 rounded-[var(--radius-sm)] font-mono text-[11px] text-ink-700 break-all">
        {shareUrl}
      </div>
      <div className="text-[12px] text-ink-500 leading-[1.55]">
        所有外部访客访问该 URL 立即返回 410。如需重新分享，撤销后可创建新链接（新 URL）。
      </div>
    </div>
  );
}

/** 轻量开关，沿用 ink 色板，不引入新依赖。 */
function ToggleSwitch({
  checked,
  onToggle,
  disabled,
  label,
  testId,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      data-testid={testId}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-[var(--duration-fast)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:opacity-50 ${
        checked ? "bg-ink-900" : "bg-ink-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-fast)] ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

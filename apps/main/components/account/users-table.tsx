"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useModalStack } from "@/components/modal-stack";
import { accountsApi, type AccountUser, type PasswordResetResult } from "@/lib/api-client";
import { accountErrorMessage } from "@/lib/account-ui/feedback";
import { accountCard, AccountNotice } from "./form-parts";

export function UsersTable({ initialUsers, currentUserId }: { initialUsers: AccountUser[]; currentUserId: string }) {
  const { data, error } = useSWR("/api/v1/admin/users", accountsApi.users, { fallbackData: { users: initialUsers }, shouldRetryOnError: false });
  const [target, setTarget] = useState<AccountUser | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return <div className="space-y-4">
    <p className="text-[12px] text-ink-500">按注册时间倒序显示。这里只能重置其他账号的密码；自己的密码请在个人资料中修改。</p>
    <AccountNotice error>{error ? accountErrorMessage(error) : ""}</AccountNotice>
    <div className={`${accountCard} overflow-x-auto`}>
      <table className="w-full text-left text-[12px] whitespace-nowrap">
        <thead className="text-ink-500"><tr>{["姓名", "邮箱", "角色", "注册时间（UTC）", "密码状态", "操作"].map((label) => <th key={label} className="font-medium pb-3 pr-5">{label}</th>)}</tr></thead>
        <tbody>{data.users.map((user) => <tr key={user.id} className="border-t border-ink-150">
          <td className="py-3 pr-5 font-medium"><span className="block max-w-[160px] truncate" title={user.name}>{user.name}{user.id === currentUserId ? "（本人）" : ""}</span></td>
          <td className="py-3 pr-5 text-ink-600"><span className="block max-w-[180px] truncate" title={user.email ?? undefined}>{user.email ?? "未填写"}</span></td>
          <td className="py-3 pr-5">{user.role === "admin" ? "管理员" : "编辑者"}</td>
          <td className="py-3 pr-5 font-mono text-[11px]">{user.createdAt.slice(0, 19).replace("T", " ")}</td>
          <td className="py-3 pr-5">{user.passwordMode === "shared" ? "团队共享密码" : "个人密码"}</td>
          <td className="py-3">{user.id === currentUserId ? <span className="text-ink-400">—</span> : <Button variant="secondary" size="sm" onClick={(event) => { trigger.current = event.currentTarget; setTarget(user); }}>重置密码</Button>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {target && <ResetPasswordDialog key={target.id} user={target} onClose={() => setTarget(null)} returnFocus={() => trigger.current?.focus()} />}
  </div>;
}

function ResetPasswordDialog({ user, onClose, returnFocus }: { user: AccountUser; onClose: () => void; returnFocus: () => void }) {
  // This component is mounted anew for each dialog, so revocation never carries over.
  const [revokeApiTokens, setRevokeApiTokens] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PasswordResetResult | null>(null);
  const [copied, setCopied] = useState(false);
  const close = () => { if (!busy.current) onClose(); };
  useModalStack(true, () => { close(); return true; });
  async function reset() {
    if (busy.current || result) return;
    busy.current = true; setPending(true); setError("");
    try { setResult(await accountsApi.resetPassword(user.id, revokeApiTokens)); }
    catch (error) { setError(accountErrorMessage(error)); }
    finally { busy.current = false; setPending(false); }
  }
  async function copy() {
    if (!result) return;
    try { await navigator.clipboard.writeText(`账号：${result.user.name}\n邮箱：${result.user.email ?? "未填写"}\n密码：${result.password}`); setCopied(true); setError(""); }
    catch { setError("复制失败，请手动复制上方账号信息"); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="w-[480px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto p-5" showClose={!pending}
      onEscapeKeyDown={(event) => event.preventDefault()} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(); }}>
      <DialogTitle className="pr-6 break-words">{result ? "密码已重置" : `将「${user.name}」的密码重置为 600109？`}</DialogTitle>
      <DialogDescription>该用户原有的主站登录会话将在 60 秒内失效。</DialogDescription>
      {result ? <div className="space-y-3 mt-4">
        <dl className="text-[13px] bg-ink-50 border border-ink-200 rounded-[var(--radius-md)] p-3 space-y-2 break-all">
          <div><dt className="inline text-ink-500">账号：</dt><dd className="inline">{result.user.name}</dd></div>
          <div><dt className="inline text-ink-500">邮箱：</dt><dd className="inline">{result.user.email ?? "未填写"}</dd></div>
          <div><dt className="inline text-ink-500">密码：</dt><dd className="inline font-mono">{result.password}</dd></div>
        </dl>
        <AccountNotice>{result.apiTokensRevoked ? "已撤销该用户全部 API Token。CLI、G-canvas 等工具需要重新登录授权。" : "已保留工具授权，无需重新授权。"}</AccountNotice>
        <p className="text-[11px] text-ink-500">请通过可信渠道告知本人，固定密码可能被他人猜到。</p>
      </div> : <label className="flex items-start gap-2 mt-5 text-[12px] text-ink-700">
        <input type="checkbox" className="mt-0.5" checked={revokeApiTokens} disabled={pending} onChange={(event) => setRevokeApiTokens(event.target.checked)} />
        <span>同时撤销该用户全部 API Token<span className="block text-ink-500 mt-1">勾选后，CLI、G-canvas 等工具需要重新登录授权。</span></span>
      </label>}
      <p className="text-[11px] text-ink-500 leading-relaxed my-4">不影响项目数据与成员身份；已签发的预览会话不在本次退出范围。</p>
      <AccountNotice error>{error}</AccountNotice>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" disabled={pending} onClick={close}>{result ? "完成" : "取消"}</Button>
        {result ? <Button onClick={copy}>{copied ? "已复制" : "复制账号信息"}</Button> : <Button onClick={reset} disabled={pending}>{pending ? "重置中…" : "确认重置"}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

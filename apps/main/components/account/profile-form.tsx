"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { accountsApi, type AccountProfile } from "@/lib/api-client";
import { accountErrorMessage, personalPasswordError } from "@/lib/account-ui/feedback";
import { afterPasswordUpdate } from "@/lib/account-ui/personal-password";
import { accountCard, AccountField, AccountNotice } from "./form-parts";

export function ProfileForm({ initialUser, allowEmptySharedPassword }: { initialUser: AccountProfile; allowEmptySharedPassword: boolean }) {
  const { data: user } = useSWR("/api/v1/me", accountsApi.me, { fallbackData: initialUser });
  const [name, setName] = useState(initialUser.name);
  const [email, setEmail] = useState(initialUser.email ?? "");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setPending(true); setError(""); setMessage("");
    try {
      const saved = await accountsApi.updateProfile({ name, ...(email.trim() || user.email !== null ? { email } : {}) });
      setName(saved.name); setEmail(saved.email ?? ""); setMessage("个人资料已保存");
    } catch (error) { setError(accountErrorMessage(error)); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="max-w-[640px] space-y-5">
    <section className={accountCard} aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="text-[15px] font-medium mb-4">基本资料</h2>
      <form onSubmit={save} className="space-y-4">
        <AccountField id="profile-name" label="姓名" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="nickname" hint="1–64 个字符，不包含 @" />
        <AccountField id="profile-email" label="邮箱" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required={user.email !== null} hint={user.email === null ? "老账号尚未填写邮箱，可在这里补充" : undefined} />
        <p className="text-[12px] text-ink-500">站点角色：<span className="text-ink-700">{user.role === "admin" ? "管理员" : "编辑者"}</span>（只读）</p>
        <AccountNotice error>{error}</AccountNotice><AccountNotice>{message}</AccountNotice>
        <Button type="submit" disabled={pending}>{pending ? "保存中…" : "保存资料"}</Button>
      </form>
    </section>
    <section className={accountCard} aria-labelledby="password-heading">
      <h2 id="password-heading" className="text-[15px] font-medium mb-2">密码</h2>
      <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">{user.passwordMode === "shared" ? "当前使用团队共享密码，请设置个人密码。" : "当前使用个人密码。修改密码需要验证当前密码。"} 自行改密不会撤销 API Token。</p>
      <PasswordForm shared={user.passwordMode === "shared"} allowEmptySharedPassword={allowEmptySharedPassword} />
    </section>
  </div>;
}

/** With callbackUrl, a successful update continues there (or to sign-in that returns there). */
export function PasswordForm({ shared, allowEmptySharedPassword, callbackUrl }: { shared: boolean; allowEmptySharedPassword: boolean; callbackUrl?: string }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(false);
  const [reauthUrl, setReauthUrl] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || reauthUrl) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = { currentPassword: String(data.get("currentPassword") ?? ""), newPassword: String(data.get("newPassword") ?? ""), confirmPassword: String(data.get("confirmPassword") ?? "") };
    const invalid = personalPasswordError(body.newPassword, body.confirmPassword);
    if (invalid) { setError(invalid); return; }
    busy.current = true; setPending(true); setError(""); setUpdated(false);
    try {
      const result = await accountsApi.changePassword(body);
      if (result.passwordUpdated) {
        form.reset();
        const next = afterPasswordUpdate(result, callbackUrl ?? "/settings/profile");
        if ("reauthUrl" in next) setReauthUrl(next.reauthUrl);
        else if (callbackUrl) window.location.assign(next.continueTo);
        else setUpdated(true);
      }
    } catch (error) { setError(accountErrorMessage(error)); }
    finally { busy.current = false; setPending(false); }
  }
  return reauthUrl ? <div className="space-y-3"><AccountNotice>密码已更新，需要重新登录，无需再次提交修改。若管理员同时重置过密码，请使用当前有效凭据登录。</AccountNotice><Link className="text-[13px] underline" href={reauthUrl}>重新登录</Link></div> : <form onSubmit={save} className="space-y-4">
    <AccountField id="current-password" name="currentPassword" label={shared ? "团队共享密码" : "当前密码"} type="password" autoComplete="current-password" required={!(shared && allowEmptySharedPassword)} />
    <AccountField id="new-password" name="newPassword" label="新密码" type="password" autoComplete="new-password" required hint="至少 6 个字符，UTF-8 长度不超过 72 字节" />
    <AccountField id="confirm-password" name="confirmPassword" label="确认新密码" type="password" autoComplete="new-password" required />
    <AccountNotice error>{error}</AccountNotice><AccountNotice>{updated ? "密码已更新，当前设备保持登录；其他主站旧会话将在 60 秒内失效。" : ""}</AccountNotice>
    <Button type="submit" disabled={pending}>{pending ? "更新中…" : "更新密码"}</Button>
  </form>;
}

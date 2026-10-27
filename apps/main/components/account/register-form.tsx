"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { accountsApi } from "@/lib/api-client";
import { accountEntryUrl, safeCallbackUrl } from "@/lib/account-ui/safe-callback";
import { accountErrorMessage, personalPasswordError } from "@/lib/account-ui/feedback";
import { AccountField, AccountNotice } from "./form-parts";

export function RegisterForm({ callbackUrl }: { callbackUrl: string }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || registered) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? "");
    const body = { name: value("name"), email: value("email"), password: value("password"), confirmPassword: value("confirmPassword") };
    const invalid = personalPasswordError(body.password, body.confirmPassword);
    if (invalid) { setError(invalid); return; }
    busy.current = true; setPending(true); setError("");
    try {
      const result = await accountsApi.register(body);
      if (result.registered) {
        form.reset(); setRegistered(true);
        if (result.authenticated && !result.reauthRequired) window.location.assign(safeCallbackUrl(callbackUrl));
      }
    } catch (error) { setError(accountErrorMessage(error)); }
    finally { busy.current = false; setPending(false); }
  }
  const loginUrl = accountEntryUrl("/login", callbackUrl);
  if (registered) return <div className="space-y-4"><AccountNotice>注册成功，请登录。账号已创建，无需再次注册。</AccountNotice><Link href={`${loginUrl}&reauth=1`} className="text-[13px] underline">前往登录</Link></div>;
  return <form onSubmit={submit} className="space-y-4">
    <AccountField id="register-name" name="name" label="姓名" required autoFocus autoComplete="nickname" hint="1–64 个字符，不包含 @" />
    <AccountField id="register-email" name="email" label="邮箱" type="email" required autoComplete="email" />
    <AccountField id="register-password" name="password" label="密码" type="password" required autoComplete="new-password" hint="至少 6 个字符，UTF-8 长度不超过 72 字节" />
    <AccountField id="register-confirm" name="confirmPassword" label="确认密码" type="password" required autoComplete="new-password" />
    <AccountNotice error>{error}</AccountNotice>
    <Button type="submit" className="w-full" size="lg" disabled={pending}>{pending ? "注册中…" : "注册账号"}</Button>
    <Link href={loginUrl} className="block text-center text-[12px] underline underline-offset-4">已有账号，返回登录</Link>
  </form>;
}

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { AccountField, AccountNotice } from "./form-parts";
import { accountEntryUrl } from "@/lib/account-ui/safe-callback";

export function LoginForm({ callbackUrl, allowEmptySharedPassword }: { callbackUrl: string; allowEmptySharedPassword: boolean }) {
  const [state, action, pending] = useActionState(loginAction.bind(null, callbackUrl), { message: "" });
  return <form action={action} className="space-y-4">
    <AccountField id="login-identifier" name="identifier" label="用户名或邮箱" autoComplete="username" required autoFocus />
    <AccountField id="login-password" name="password" label="密码" type="password" autoComplete="current-password" required={!allowEmptySharedPassword} />
    <AccountNotice error>{state.message}</AccountNotice>
    <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "登录中…" : "进入工作台"}</Button>
    <p className="text-[11px] text-ink-500">忘记密码请联系站点管理员重置。</p>
    <Link href={accountEntryUrl("/register", callbackUrl)} className="block text-center text-[12px] underline underline-offset-4">注册账号</Link>
  </form>;
}

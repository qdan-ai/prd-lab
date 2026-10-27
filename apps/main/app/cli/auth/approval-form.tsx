"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { CliApprovalState } from "@/lib/account-ui/cli-approval";

export function ApprovalForm({ action }: { action: () => Promise<CliApprovalState> }) {
  const [state, submit, pending] = useActionState(action, { message: "" });
  const next = state.login ? { href: state.login, label: "重新登录后授权" }
    : state.reopen ? { href: state.reopen, label: "重新打开授权页" }
    : state.setPassword ? { href: state.setPassword, label: "设置个人密码" }
    : null;
  return <form action={submit}>
    {state.message && <p role="alert" className="text-[13px] text-ink-700 mb-3">{state.message}</p>}
    {next ? <a className="text-[13px] underline" href={next.href}>{next.label}</a> : <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "授权中…" : "授权并返回 CLI"}
    </Button>}
  </form>;
}

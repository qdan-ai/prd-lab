"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";

type ApprovalState = { message: string; login?: string; reopen?: string };

export function ApprovalForm({ action }: { action: () => Promise<ApprovalState> }) {
  const [state, submit, pending] = useActionState(action, { message: "" });
  return <form action={submit}>
    {state.message && <p role="alert" className="text-[13px] text-ink-700 mb-3">{state.message}</p>}
    {state.login || state.reopen ? <a className="text-[13px] underline" href={state.login ?? state.reopen}>
      {state.login ? "重新登录后授权" : "重新打开授权页"}
    </a> : <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "授权中…" : "授权并返回 CLI"}
    </Button>}
  </form>;
}

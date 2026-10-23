import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";

export const accountCard = "bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-5";

export function AccountField({ label, hint, ...props }: ComponentProps<typeof Input> & { label: string; hint?: string }) {
  return <div>
    <label htmlFor={props.id} className="block text-[12px] font-medium text-ink-700 mb-1.5">{label}</label>
    <Input {...props} aria-describedby={hint ? `${props.id}-hint` : undefined} />
    {hint && <p id={`${props.id}-hint`} className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">{hint}</p>}
  </div>;
}

export function AccountNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  if (!children) return null;
  return <p role={error ? "alert" : "status"} className={`text-[12px] rounded-[var(--radius-sm)] px-3 py-2 leading-relaxed ${error ? "text-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)]" : "text-ink-700 bg-ink-100"}`}>{children}</p>;
}

export function AccountEntry({ title, children }: { title: string; children: ReactNode }) {
  return <main className="min-h-screen flex items-center justify-center bg-ink-50 px-4 py-10">
    <div className="w-full max-w-[380px]">
      <div className="text-center mb-6">
        <Link href="/projects" className="inline-flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)] bg-ink-900 text-ink-50 font-semibold text-[17px] mb-3 shadow-[var(--shadow-sm)]" aria-label="PRD-Lab 工作台">P</Link>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">{title}</h1>
        <p className="text-[13px] text-ink-500 mt-1">PRD-Lab · 方案与协同评审</p>
      </div>
      <div className={accountCard}>{children}</div>
    </div>
  </main>;
}

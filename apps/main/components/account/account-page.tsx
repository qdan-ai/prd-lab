import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { CommandSwitcher } from "@/components/command-switcher";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { AccountEntry, AccountNotice } from "./form-parts";

export function AccountPage({ title, userName, children }: { title: string; userName: string; children: ReactNode }) {
  async function logout() { "use server"; await signOut({ redirectTo: "/login" }); }
  return <div className="min-h-screen bg-ink-50">
    <ProjectsHeader userName={userName} logoutAction={logout} />
    <main className="max-w-[960px] mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink-900 mb-6">{title}</h1>
      {children}
    </main>
    <CommandSwitcher /><GlobalHotkeys />
  </div>;
}

export function AccountUnavailable({ path }: { path: string }) {
  return <AccountEntry title="账户服务暂时不可用"><AccountNotice error>暂时无法读取账户资料，请稍后重试。</AccountNotice><Link className="inline-block mt-4 text-[13px] underline" href={path}>重新加载</Link></AccountEntry>;
}

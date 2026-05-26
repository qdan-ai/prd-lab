import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { CommandSwitcher } from "@/components/command-switcher";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { TokenManager } from "./token-manager";
import { QuickstartGuide } from "./quickstart-guide";
import { SkillDownloadCard } from "./skill-download-card";

/**
 * /settings/tokens —— AI 接入引导 + API token 管理
 *
 * 信息架构（小白视角，从上到下顺读）：
 *   1. 教程 (QuickstartGuide) - 5 步把 AI 接上来
 *   2. Skill 下载卡片 - 下载入口（教程 Step 5 提到的那个 zip）
 *   3. Token 管理 (TokenManager) - 进阶：自动化脚本场景手动签发 token
 *
 * 从 UserMenu "个人设置" 入口跳来。挂 CommandSwitcher + GlobalHotkeys
 * 确保 logo 跳 /projects 和"切换项目"按钮 + ⌘K 都可用。
 */
export default async function TokensSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/settings/tokens");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  const userName = session.user.name ?? "未命名";

  return (
    <div className="min-h-screen bg-ink-50">
      <ProjectsHeader userName={userName} logoutAction={logout} />
      <main className="max-w-[760px] mx-auto px-6 py-10">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink-900">接入 AI 工具</h1>
          <p className="text-[13px] text-ink-500 mt-1 leading-relaxed">
            让 Claude Code 一句话替你打包 demo、上传到 PRD-Lab、生成带密码分享链接给老板。下面 4 步搞定。
          </p>
        </div>

        <QuickstartGuide />

        <SkillDownloadCard />

        <details className="group mt-6 bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] overflow-hidden">
          <summary className="cursor-pointer list-none px-5 py-4 flex items-start gap-3 hover:bg-ink-50 transition-colors">
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-medium text-ink-900">API Tokens（自动化脚本用）</h2>
              <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">
                token 是命令行调本站时用的"通行证"。
                <strong className="text-ink-700">正常用 AI 接入不用碰这里</strong>——
                跑 <code className="font-mono">prd login</code> 时会自动生成。仅当你跑自动化脚本（CI / 别人的电脑）才需要手动签一个。点击展开。
              </p>
            </div>
            <span
              aria-hidden
              className="flex-shrink-0 mt-1 text-ink-400 text-[18px] leading-none transition-transform group-open:rotate-90"
            >
              ›
            </span>
          </summary>
          <div className="px-5 pb-5 pt-1 border-t border-ink-150">
            <p className="text-[11px] text-[color:var(--color-danger)] mt-3 mb-4 leading-relaxed">
              ⚠ token 等同你的账户权限。请勿提交到 Git / 群聊；泄漏后立刻在下方撤销重建。
            </p>
            <TokenManager />
          </div>
        </details>
      </main>
      <CommandSwitcher />
      <GlobalHotkeys />
    </div>
  );
}

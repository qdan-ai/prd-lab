import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, shareLinks } from "@prd-lab/core";
import { getShareSession } from "@/lib/share/share-session";
import { ShareLoginForm } from "./share-login-form";

type Props = {
  params: Promise<{ shareId: string }>;
};

/**
 * /share/[shareId]/login
 *
 * SSR：先校验 shareId 存在 + 未撤销，再渲染表单。
 * - 不存在 → 404
 * - 已撤销 → 410
 * - 无密码 → 仅当 getShareSession 判定可放行时重定向到内容页；若链接已失效
 *   （snapshot/version/project 归档）则渲染终态页，避免与内容页相互 redirect 成死循环
 * - 有密码 → 渲染密码表单（提交 POST /share/[shareId]/api/login）
 */
export default async function ShareLoginPage({ params }: Props) {
  const { shareId } = await params;

  const rows = await db
    .select({ revokedAt: shareLinks.revokedAt, passwordHash: shareLinks.passwordHash })
    .from(shareLinks)
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  if (!rows[0]) {
    return (
      <ShareErrorPanel title="链接不存在" message="该分享链接不存在或已被永久撤销。" />
    );
  }
  if (rows[0].revokedAt !== null) {
    return <ShareErrorPanel title="分享已撤销" message="该分享链接已被项目所有者撤销，无法再访问。" />;
  }
  if (rows[0].passwordHash === null) {
    // 无密码链接本应直接看内容页。但仅当内容页确会放行（getShareSession=ok）时才跳转；
    // 链接失效（归档）时 getShareSession 返 not_found，内容页会再跳回这里 → 死循环，
    // 故此处直接渲染终态页（与内容页归档文案一致），不跳转。
    const session = await getShareSession(shareId);
    if (session.kind === "ok") {
      redirect(`/share/${shareId}`);
    }
    if (session.kind === "revoked") {
      return <ShareErrorPanel title="分享已撤销" message="该分享链接已被项目所有者撤销，无法再访问。" />;
    }
    return <ShareErrorPanel title="链接已失效" message="该版本已被删除，请联系项目方。" />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50">
      <div className="w-[400px] max-w-[calc(100vw-32px)] bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-popup)] p-8">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink-900 mb-2">
          PRD-Lab · 分享访问
        </h1>
        <p className="text-[12px] text-ink-500 mb-6 leading-[1.55]">
          输入访问密码以查看该版本。
        </p>
        <ShareLoginForm shareId={shareId} />
      </div>
    </main>
  );
}

function ShareErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50">
      <div className="w-[400px] max-w-[calc(100vw-32px)] bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-popup)] p-8 text-center">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink-900 mb-2">{title}</h1>
        <p className="text-[13px] text-ink-500 leading-[1.55]">{message}</p>
      </div>
    </main>
  );
}

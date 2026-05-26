import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, shareLinks } from "@prd-lab/core";
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
 * - 正常 → 渲染密码表单（提交 POST /share/[shareId]/api/login）
 */
export default async function ShareLoginPage({ params }: Props) {
  const { shareId } = await params;

  const rows = await db
    .select({ revokedAt: shareLinks.revokedAt })
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

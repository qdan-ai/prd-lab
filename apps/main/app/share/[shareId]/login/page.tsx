import { shareAccountLoginUrl } from "@/lib/share/response";
import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, shareLinks } from "@prd-lab/core";
import { repoProjectIdOfVersion } from "@prd-lab/core/repo";
import { getShareSession } from "@/lib/share/share-session";
import { versionQuery } from "@/lib/repo/share-entry";
import { ShareLoginForm } from "./share-login-form";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /share/[shareId]/login
 *
 * SSR：先校验 shareId 存在 + 未撤销，再渲染表单。
 * - 不存在 → 404
 * - 已撤销 → 410
 * - 已能放行（无密码，或密码 cookie 仍有效）→ 重定向到内容页
 * - 链接已失效（方案 / 项目归档）→ 渲染终态页（内容页对失效链接会跳回这里，不能再跳回去，否则成死循环）
 * - 有密码且未登入 → 渲染密码表单（提交 POST /share/[shareId]/api/login），登入后回内容页
 * `?v=`（仓库项目的版本号）与 `?k=`（锁版本链接的版本 key）原样带回内容页，访客输完密码仍落到链接指定的版本。
 * 仓库项目的链接分享的是整个项目，提示语说「该项目」；普通方案链接说「该版本」。
 */
export default async function ShareLoginPage({ params, searchParams }: Props) {
  const { shareId } = await params;
  const { v, k } = await searchParams;
  const contentHref = `/share/${shareId}${versionQuery(
    typeof v === "string" ? v : null,
    typeof k === "string" ? k : null,
  )}`;

  const session = await getShareSession(shareId);
  if (session.kind === "unauthorized") redirect(shareAccountLoginUrl(shareId, versionQuery(typeof v === "string" ? v : null, typeof k === "string" ? k : null)));
  if (session.kind === "forbidden") notFound();

  const rows = await db
    .select({ revokedAt: shareLinks.revokedAt, passwordHash: shareLinks.passwordHash, versionId: shareLinks.versionId })
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
  if (session.kind === "ok") {
    redirect(contentHref);
  }
  if (session.kind === "revoked") {
    return <ShareErrorPanel title="分享已撤销" message="该分享链接已被项目所有者撤销，无法再访问。" />;
  }
  if (session.kind === "not_found") {
    return <ShareErrorPanel title="链接已失效" message="分享的内容已被删除，请联系项目方。" />;
  }

  const isRepo = (await repoProjectIdOfVersion(rows[0].versionId)) !== null;

  return (
    <main className="min-h-screen flex items-center justify-center bg-ink-50">
      <div className="w-[400px] max-w-[calc(100vw-32px)] bg-white border border-ink-200 rounded-[var(--radius-lg)] shadow-[var(--shadow-popup)] p-8">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink-900 mb-2">
          PRD-Lab · 分享访问
        </h1>
        <p className="text-[12px] text-ink-500 mb-6 leading-[1.55]">
          {isRepo ? "输入访问密码以查看该项目。" : "输入访问密码以查看该版本。"}
        </p>
        <ShareLoginForm shareId={shareId} contentHref={contentHref} />
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

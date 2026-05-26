import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, shareLinks, snapshots, users } from "@prd-lab/core";
import { getShareSession } from "@/lib/share/share-session";
import { ShareFileList } from "@/components/share-file-list";

type Props = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /share/[shareId] · S9：极简 chrome + 文件列表 + 点击新窗口预览。
 *
 * SSR 分支：
 *   1. URL 含 ?snapshot=* → 308 redirect 到纯 share URL（不暴露内部 snapshot id）
 *   2. share 不存在 → "链接不存在"
 *   3. share 已 revoked → "已撤销"
 *   4. cookie 无 / pv 不匹配 / 过期 → /share/[shareId]/login
 *   5. snapshot archived → "链接已失效"
 *   6. 正常 → 渲染文件列表
 */
export default async function SharePage({ params, searchParams }: Props) {
  const { shareId } = await params;
  const search = await searchParams;

  if (search.snapshot !== undefined) {
    redirect(`/share/${shareId}`);
  }

  const shareRows = await db
    .select({ id: shareLinks.id, revokedAt: shareLinks.revokedAt })
    .from(shareLinks)
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  if (!shareRows[0]) return <ShareErrorPanel title="链接不存在" message="该分享链接不存在或已被撤销。" />;
  if (shareRows[0].revokedAt !== null)
    return <ShareErrorPanel title="分享已撤销" message="该分享链接已被项目所有者撤销，无法再访问。" />;

  const session = await getShareSession(shareId);
  if (session.kind !== "ok") {
    redirect(`/share/${shareId}/login`);
  }

  const snapRows = await db
    .select({
      id: snapshots.id,
      seqNo: snapshots.seqNo,
      versionLabel: snapshots.versionLabel,
      entryHtmlPath: snapshots.entryHtmlPath,
      createdAt: snapshots.createdAt,
      archivedAt: snapshots.archivedAt,
      uploaderName: users.name,
    })
    .from(snapshots)
    .innerJoin(users, eq(snapshots.uploaderId, users.id))
    .where(eq(snapshots.id, session.snapshotId))
    .limit(1);
  const snap = snapRows[0];
  if (!snap || snap.archivedAt !== null) {
    return <ShareErrorPanel title="链接已失效" message="该版本已被删除，请联系项目方。" />;
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-white"
      data-testid="share-page"
    >
      <header
        className="h-11 flex items-center gap-2 px-3 border-b border-ink-200 bg-white shrink-0 select-none"
        role="banner"
      >
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-[var(--radius-sm)] bg-ink-900 text-ink-50 text-[10px] font-semibold flex items-center justify-center">
            P
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-ink-900">PRD-Lab</span>
        </div>
        <div className="h-4 w-px bg-ink-200" aria-hidden />
        <div
          className="flex items-center gap-2 text-[12px] text-ink-700 tabular-nums"
          data-testid="share-chrome-meta"
        >
          <span className="font-medium">{snap.versionLabel ?? `v${snap.seqNo}`}</span>
          <span className="text-ink-300">·</span>
          <span>{snap.uploaderName}</span>
          <span className="text-ink-300">·</span>
          <span>{new Date(snap.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
        </div>
        <div className="flex-1" />
        <div className="text-[11px] text-ink-500" data-testid="share-chrome-visitor">
          访客模式
        </div>
      </header>
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <ShareFileList
          shareId={shareId}
          snapshotId={snap.id}
          entryHtmlPath={snap.entryHtmlPath}
        />
      </main>
    </div>
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

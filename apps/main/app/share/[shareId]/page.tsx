import { sharedSnapshotAvailable } from "@/lib/share/snapshot-access";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, shareLinks, snapshots, users, versions } from "@prd-lab/core";
import { getShareSession } from "@/lib/share/share-session";
import { headersOrigin } from "@/lib/api/request-origin";
import { repoShareEntryUrl, versionQuery } from "@/lib/repo/share-entry";
import { ShareFileList } from "@/components/share-file-list";
import { ShareSnapshotSwitcher } from "@/components/share-snapshot-switcher";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /share/[shareId] · S19 方案级分享：访客可查看方案下所有活跃版本并切换。
 *
 * SSR 分支：
 *   1. share 不存在 → "链接不存在"
 *   2. share 已 revoked → "已撤销"
 *   3. cookie 无 / pv 不匹配 / 过期 → /share/[shareId]/login（`?v=`、`?k=` 一并带过去）
 *   4. 方案无活跃 snapshot → "还没有可查看的版本"
 *   5. ?snapshot=v{seq} 非法 / 未命中活跃列表 → redirect 去 query（回默认最新）
 *   6. 正常 → 渲染选中版本的文件列表 + 版本切换器
 *   仓库项目（链接绑定的是仓库的系统方案）：3 之后直接签仓库级令牌跳预览站查看器，`?v=`、`?k=` 原样转交
 */
export default async function SharePage({ params, searchParams }: Props) {
  const { shareId } = await params;
  const search = await searchParams;

  const shareRows = await db
    .select({ id: shareLinks.id, revokedAt: shareLinks.revokedAt })
    .from(shareLinks)
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  if (!shareRows[0]) return <ShareErrorPanel title="链接不存在" message="该分享链接不存在或已被撤销。" />;
  if (shareRows[0].revokedAt !== null)
    return <ShareErrorPanel title="分享已撤销" message="该分享链接已被项目所有者撤销，无法再访问。" />;

  const v = typeof search.v === "string" ? search.v : null;
  const k = typeof search.k === "string" ? search.k : null;
  const session = await getShareSession(shareId);
  if (session.kind !== "ok") {
    // 带上 v / k：输完密码回到同一个版本
    redirect(`/share/${shareId}/login${versionQuery(v, k)}`);
  }

  const repoEntry = await repoShareEntryUrl({
    shareId,
    versionId: session.versionId,
    pv: session.pv,
    origin: headersOrigin(await headers()),
    v,
    k,
  });
  if (repoEntry) redirect(repoEntry);

  const [versionRows, snapRows] = await Promise.all([
    db
      .select({ name: versions.name })
      .from(versions)
      .where(eq(versions.id, session.versionId))
      .limit(1),
    db
      .select({
        id: snapshots.id,
        seqNo: snapshots.seqNo,
        versionLabel: snapshots.versionLabel,
        entryHtmlPath: snapshots.entryHtmlPath,
        rendererName: snapshots.rendererName,
        createdAt: snapshots.createdAt,
        uploaderName: users.name,
      })
      .from(snapshots)
      .innerJoin(users, eq(snapshots.uploaderId, users.id))
      .where(and(eq(snapshots.versionId, session.versionId), sharedSnapshotAvailable()))
      .orderBy(desc(snapshots.seqNo)),
  ]);
  const versionName = versionRows[0]?.name ?? "";

  const latest = snapRows[0];
  if (!latest) {
    return (
      <ShareErrorPanel title="还没有可查看的版本" message="该方案还没有上传任何版本，请联系项目方。" />
    );
  }

  // 解析 ?snapshot=v{seq}：非法 / 未命中活跃列表 → redirect 去 query（URL 永远反映真实状态）
  let selected = latest;
  const rawQuery = search.snapshot;
  if (rawQuery !== undefined) {
    const match = typeof rawQuery === "string" ? /^v(\d+)$/.exec(rawQuery) : null;
    const target = match ? snapRows.find((s) => s.seqNo === Number(match[1])) : undefined;
    if (!target) redirect(`/share/${shareId}`);
    selected = target;
  }

  const switcherItems = snapRows.map((s) => ({
    seqNo: s.seqNo,
    versionLabel: s.versionLabel,
    uploaderName: s.uploaderName,
    createdAt: new Date(s.createdAt).toISOString(),
  }));

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
          <span className="font-medium">{versionName}</span>
          <span className="text-ink-300">·</span>
          <ShareSnapshotSwitcher
            shareId={shareId}
            items={switcherItems}
            activeSeq={selected.seqNo}
          />
          <span className="text-ink-300">·</span>
          <span>{selected.uploaderName}</span>
          <span className="text-ink-300">·</span>
          <span>{new Date(selected.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
        </div>
        <div className="flex-1" />
        <div className="text-[11px] text-ink-500" data-testid="share-chrome-visitor">
          访客模式
        </div>
      </header>
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <ShareFileList
          shareId={shareId}
          snapshotId={selected.id}
          entryHtmlPath={selected.entryHtmlPath}
          rendererName={selected.rendererName}
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

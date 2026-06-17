import { and, desc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, projects, snapshots, versions } from "@prd-lab/core";
import { auth, signOut } from "@/auth";
import { isAdminName } from "@/lib/auth/admins";
import { canManageProject } from "@/lib/api/owner-check";
import { TopToolbar } from "@/components/layout/top-toolbar";
import { BottomBar } from "@/components/layout/bottom-bar";
import { SidebarLeft } from "@/components/sidebar-left";
import { CanvasPlaceholder } from "@/components/layout/canvas-placeholder";
import { SnapshotFileList } from "@/components/snapshot-file-list";
import { CommandSwitcher } from "@/components/command-switcher";
import { CreateDialog } from "@/components/create-dialog";
import { DefaultOpenLeftSidebar } from "@/components/layout/default-open-left-sidebar";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { NoticeToast } from "@/components/notice-toast";

type SearchParams = Promise<{ snapshot?: string; notice?: string }>;
type Params = Promise<{ pid: string; vid: string }>;

/**
 * Version page SSR（5 分支，S9 后中央渲染文件列表而非画板）：
 *   ① 未登入 → redirect /login
 *   ② 已登入但无权 / 项目方案不存在 → 404
 *   ③ vid 存在但 ?snapshot=v{seq} 不存在 → 302 到默认（去 query）
 *   ④ seq 存在但 archived → 302 + ?notice=snapshot-archived
 *   ⑤ 正常 SSR；无 query 时默认渲染最新（seq 最大的活跃 snapshot）
 */
export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await auth();
  const { pid, vid } = await params;
  const sp = await searchParams;

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/projects/${pid}/versions/${vid}`);
  }

  const rows = await db
    .select({ project: projects, version: versions })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(versions.id, vid),
        eq(projects.id, pid),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  const canRead =
    row.project.visibility === "team" || row.project.ownerId === session.user.id;
  if (!canRead) notFound();

  // 管理员可管理 team 项目（与 owner 同权：上传/删快照/分享/导出）。规则统一走 canManageProject，与后端同源。
  const canManage = canManageProject(
    { ownerId: row.project.ownerId, visibility: row.project.visibility },
    { userId: session.user.id, isAdmin: isAdminName(session.user.name) },
  );

  const seqMatch = typeof sp.snapshot === "string" ? /^v(\d+)$/.exec(sp.snapshot) : null;
  const targetSeq = seqMatch ? Number(seqMatch[1]) : null;

  let viewingSnapshot:
    | {
        id: string;
        seqNo: number;
        entryHtmlPath: string;
        changeNote: string;
        versionLabel: string | null;
      }
    | null = null;

  if (targetSeq !== null) {
    const target = await db
      .select({
        id: snapshots.id,
        seqNo: snapshots.seqNo,
        entryHtmlPath: snapshots.entryHtmlPath,
        changeNote: snapshots.changeNote,
        versionLabel: snapshots.versionLabel,
        archivedAt: snapshots.archivedAt,
      })
      .from(snapshots)
      .where(and(eq(snapshots.versionId, vid), eq(snapshots.seqNo, targetSeq)))
      .limit(1);
    const t = target[0];
    if (!t) {
      redirect(`/projects/${pid}/versions/${vid}`);
    }
    if (t.archivedAt !== null) {
      redirect(`/projects/${pid}/versions/${vid}?notice=snapshot-archived`);
    }
    viewingSnapshot = t;
  } else {
    const latest = await db
      .select({
        id: snapshots.id,
        seqNo: snapshots.seqNo,
        entryHtmlPath: snapshots.entryHtmlPath,
        changeNote: snapshots.changeNote,
        versionLabel: snapshots.versionLabel,
      })
      .from(snapshots)
      .where(and(eq(snapshots.versionId, vid), isNull(snapshots.archivedAt)))
      .orderBy(desc(snapshots.seqNo))
      .limit(1);
    if (latest[0]) viewingSnapshot = latest[0];
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-white"
      data-testid="version-page"
      data-viewing-seq={viewingSnapshot?.seqNo ?? ""}
    >
      <TopToolbar
        projectName={row.project.name}
        versionName={row.version.name}
        viewingSnapshotSeq={viewingSnapshot?.seqNo ?? null}
        viewingSnapshotVersionLabel={viewingSnapshot?.versionLabel ?? null}
        versionId={vid}
        snapshotId={viewingSnapshot?.id ?? null}
        ownedByMe={canManage}
        userName={session.user.name ?? "未命名"}
        logoutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {viewingSnapshot ? (
          <SnapshotFileList
            snapshotId={viewingSnapshot.id}
            entryHtmlPath={viewingSnapshot.entryHtmlPath}
            changeNote={viewingSnapshot.changeNote}
          />
        ) : (
          <CanvasPlaceholder
            versionName={row.version.name}
            versionId={vid}
            ownedByMe={canManage}
          />
        )}
      </main>
      <BottomBar
        versionId={vid}
        viewingSnapshotSeq={viewingSnapshot?.seqNo ?? null}
      />
      <SidebarLeft
        versionId={vid}
        projectId={pid}
        versionName={row.version.name}
        ownedByMe={canManage}
      />
      <CommandSwitcher />
      <CreateDialog />
      <DefaultOpenLeftSidebar />
      <GlobalHotkeys />
      <NoticeToast notice={sp.notice} />
    </div>
  );
}

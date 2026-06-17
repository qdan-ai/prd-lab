import { and, count, desc, eq, isNull, max, or } from "drizzle-orm";
import { db, projects, snapshots, versions } from "@prd-lab/core";
import { auth, signOut } from "@/auth";
import { isAdminName } from "@/lib/auth/admins";
import { canManageProject } from "@/lib/api/owner-check";
import { CommandSwitcher } from "@/components/command-switcher";
import { CreateDialog } from "@/components/create-dialog";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { WorkbenchTitleBlock } from "@/components/workbench/title-block";
import { WorkbenchTabs, type WorkbenchTab } from "@/components/workbench/tabs";
import {
  WorkbenchTabPanel,
  type WorkbenchProject,
} from "@/components/workbench/tab-panel";
import { WorkbenchSearchBox } from "@/components/workbench/search-box";

type SearchParams = Promise<{ tab?: string }>;

export default async function ProjectsListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  const userId = session.user.id;
  const userName = session.user.name ?? "未命名";
  const isAdmin = isAdminName(session.user.name);

  const params = await searchParams;
  const tab: WorkbenchTab = params.tab === "team" ? "team" : "mine";

  // 1) 项目列表
  const list = await db
    .select({
      id: projects.id,
      name: projects.name,
      visibility: projects.visibility,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        or(eq(projects.visibility, "team"), eq(projects.ownerId, userId)),
      ),
    )
    .orderBy(desc(projects.createdAt));

  // 2) 每个项目活跃 snapshot 计数 + 最近一次时间（UI 文案"版本"指 snapshot）
  const projectIds = list.map((p) => p.id);
  const snapshotStats =
    projectIds.length === 0
      ? []
      : await db
          .select({
            projectId: versions.projectId,
            snapshotCount: count(snapshots.id),
            latestAt: max(snapshots.createdAt),
          })
          .from(snapshots)
          .innerJoin(versions, eq(versions.id, snapshots.versionId))
          .where(
            and(isNull(snapshots.archivedAt), isNull(versions.archivedAt)),
          )
          .groupBy(versions.projectId);
  const snapshotCountByProject = new Map<string, number>();
  const latestSnapshotByProject = new Map<string, Date>();
  for (const r of snapshotStats) {
    snapshotCountByProject.set(r.projectId, r.snapshotCount);
    if (r.latestAt) latestSnapshotByProject.set(r.projectId, r.latestAt);
  }

  // 4) 全局最近一条 snapshot（用于副标题）
  let globalLatest: Date | null = null;
  for (const d of latestSnapshotByProject.values()) {
    if (!globalLatest || d.getTime() > globalLatest.getTime()) globalLatest = d;
  }

  // 5) Tab 口径（重叠）
  const mineList = list.filter((p) => p.ownerId === userId);
  const teamList = list.filter((p) => p.visibility === "team");

  const toCardData = (p: (typeof list)[number]): WorkbenchProject => ({
    id: p.id,
    name: p.name,
    visibility: p.visibility,
    createdAt: p.createdAt.toISOString(),
    ownedByMe: p.ownerId === userId,
    canManage: canManageProject(p, { userId, isAdmin }),
    snapshotCount: snapshotCountByProject.get(p.id) ?? 0,
    latestSnapshotAt: latestSnapshotByProject.get(p.id)?.toISOString() ?? null,
  });

  const activeProjects = tab === "team" ? teamList : mineList;

  return (
    <div className="min-h-screen bg-white">
      <ProjectsHeader userName={userName} logoutAction={logout} />

      <main className="max-w-[1600px] mx-auto px-8 py-10">
        <div className="space-y-8">
          <WorkbenchTitleBlock
            userName={userName}
            totalProjects={list.length}
            latestUploadAt={globalLatest}
          />

          <div className="space-y-5">
            <div className="flex items-end justify-between gap-4 flex-wrap border-b border-ink-200">
              <WorkbenchTabs
                active={tab}
                mineCount={mineList.length}
                teamCount={teamList.length}
              />
              <div className="pb-2.5">
                <WorkbenchSearchBox />
              </div>
            </div>
            <WorkbenchTabPanel tab={tab} projects={activeProjects.map(toCardData)} />
          </div>
        </div>
      </main>

      <CommandSwitcher />
      <CreateDialog />
      <GlobalHotkeys />
    </div>
  );
}

import { projectReadableBy, notTeamVersion } from "@prd-lab/core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, projects, versions } from "@prd-lab/core";
import { asRepoProject, findProjectForRepo, getRepoPushState, getTeamAccess } from "@prd-lab/core/repo";
import { auth, signOut } from "@/auth";
import { canEditProject, canChangeProjectVisibility } from "@/lib/api/owner-check";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { ProjectEmptyState } from "@/components/project-empty-state";
import { CommandSwitcher } from "@/components/command-switcher";
import { CreateDialog } from "@/components/create-dialog";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { RepoProjectView } from "@/components/repo-project";

type Params = Promise<{ pid: string }>;

/**
 * 项目落地页 SSR（S17）：
 *   ① 未登入 → redirect /login
 *   ② 项目不存在 / 已归档 → 404
 *   ③ 私有项目对非创建者/有效成员 → 404（防探测）
 *   ④ G-canvas 仓库项目 → 渲染仓库项目页（推送情况、访客链接、在查看器中打开；版本只读）
 *   ⑤ 有 ≥1 活跃方案 → redirect 到最新方案的版本页
 *   ⑥ 0 方案 → 渲染空状态引导新建方案
 */
export default async function ProjectLandingPage({ params }: { params: Params }) {
  const session = await auth();
  const { pid } = await params;

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/projects/${pid}`);
  }

  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, pid), projectReadableBy(session.user.id)))
    .limit(1);
  const project = rows[0];
  if (!project) notFound();

  // Existing UI canManage means creator-only; download/visibility controls are separate capabilities.
  const canManage = canEditProject(
    { ownerId: project.ownerId },
    { userId: session.user.id },
  );

  if (project.kind === "repo") {
    return <RepoProjectPage project={project} canManage={canManage} canChangeVisibility={canChangeProjectVisibility(project, { userId: session.user.id, isAdmin: session.user.role === "admin" }, project.visibility === "team" ? "private" : "team")} userName={session.user.name ?? "未命名"} />;
  }

  const latest = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.projectId, pid), isNull(versions.archivedAt), notTeamVersion(versions.id)))
    .orderBy(desc(versions.seqNo))
    .limit(1);
  if (latest[0]) {
    redirect(`/projects/${pid}/versions/${latest[0].id}`);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <ProjectsHeader
        userName={session.user.name ?? "未命名"}
        logoutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      <main className="flex-1 flex flex-col">
        <ProjectEmptyState projectId={pid} projectName={project.name} ownedByMe={canManage} />
      </main>
      <CommandSwitcher />
      <CreateDialog />
      <GlobalHotkeys />
    </div>
  );
}

async function RepoProjectPage({
  project,
  canManage,
  canChangeVisibility,
  userName,
}: {
  project: typeof projects.$inferSelect;
  canManage: boolean;
  canChangeVisibility: boolean;
  userName: string;
}) {
  const row = await findProjectForRepo(project.id);
  if (!row) notFound();
  const repo = asRepoProject(row);
  const push = await getRepoPushState(repo);
  const live = push.versions.filter((v) => !v.withdrawn);
  const session = await auth();
  const teamAccess = session?.user?.id ? await getTeamAccess(project.id, session.user.id) : null;
  const showMembers = !!teamAccess?.enabled && !!teamAccess.role;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <ProjectsHeader
        userName={userName}
        logoutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      <RepoProjectView
        project={{ id: project.id, name: project.name, visibility: project.visibility }}
        systemVersionId={repo.versionId}
        summary={push.project.summary}
        canManage={canManage}
        canChangeVisibility={canChangeVisibility}
        showMembers={showMembers}
        pushedAt={push.pushedAt}
        pushedBy={push.pushedBy}
        versions={live
          .map((v) => ({
            key: v.key,
            number: v.number,
            name: v.name,
            sealedAt: v.sealedAt,
            online: v.key === push.online.key,
          }))
          .reverse()}
        draft={push.draft ? { pushedAt: push.draft.pushedAt } : null}
      />
      <CommandSwitcher />
      <CreateDialog />
      <GlobalHotkeys />
    </div>
  );
}

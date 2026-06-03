import { and, desc, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, projects, versions } from "@prd-lab/core";
import { auth, signOut } from "@/auth";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { ProjectEmptyState } from "@/components/project-empty-state";
import { CommandSwitcher } from "@/components/command-switcher";
import { CreateDialog } from "@/components/create-dialog";
import { GlobalHotkeys } from "@/components/global-hotkeys";

type Params = Promise<{ pid: string }>;

/**
 * 项目落地页 SSR（S17）：
 *   ① 未登入 → redirect /login
 *   ② 项目不存在 / 已归档 → 404
 *   ③ 私有项目对非 owner → 404（防探测）
 *   ④ 有 ≥1 活跃方案 → redirect 到最新方案的版本页
 *   ⑤ 0 方案 → 渲染空状态引导新建方案
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
    .where(and(eq(projects.id, pid), isNull(projects.archivedAt)))
    .limit(1);
  const project = rows[0];
  if (!project) notFound();

  const ownedByMe = project.ownerId === session.user.id;
  const canRead = project.visibility === "team" || ownedByMe;
  if (!canRead) notFound();

  const latest = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.projectId, pid), isNull(versions.archivedAt)))
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
        <ProjectEmptyState projectId={pid} projectName={project.name} ownedByMe={ownedByMe} />
      </main>
      <CommandSwitcher />
      <CreateDialog />
      <GlobalHotkeys />
    </div>
  );
}

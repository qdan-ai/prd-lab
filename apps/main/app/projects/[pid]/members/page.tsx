import { notFound, redirect } from "next/navigation";
import { findProjectForRepo, getTeamAccess, loadTeamGate } from "@prd-lab/core/repo";
import { auth, signOut } from "@/auth";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { CommandSwitcher } from "@/components/command-switcher";
import { CreateDialog } from "@/components/create-dialog";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { TeamMembersView, TeamNotOpenedView } from "@/components/team-members";

type Params = Promise<{ pid: string }>;

/**
 * 项目页「成员」：团队项目的成员可见；添加、改角色、移除只有负责人能做。
 * 从没开启过团队的 G-canvas 项目：负责人看到去 G-canvas 开启的提示，其他人 404。
 */
export default async function ProjectMembersPage({ params }: { params: Params }) {
  const session = await auth();
  const { pid } = await params;
  if (!session?.user?.id) redirect(`/login?callbackUrl=/projects/${pid}/members`);

  const row = await findProjectForRepo(pid);
  if (!row) notFound();
  const access = await getTeamAccess(pid, session.user.id);
  if (!access || !access.role) notFound();
  if (!access.enabled && (access.role !== "lead" || row.kind !== "repo")) notFound();
  const gate = access.enabled ? await loadTeamGate(pid) : null;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <ProjectsHeader
        userName={session.user.name ?? "未命名"}
        logoutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      {gate ? (
        <TeamMembersView project={{ id: pid, name: row.name }} myRole={access.role} ready={gate.ready} />
      ) : (
        <TeamNotOpenedView project={{ id: pid, name: row.name }} />
      )}
      <CommandSwitcher />
      <CreateDialog />
      <GlobalHotkeys />
    </div>
  );
}

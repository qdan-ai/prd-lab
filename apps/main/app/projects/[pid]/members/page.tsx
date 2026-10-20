import { notFound, redirect } from "next/navigation";
import { findProjectForRepo, getTeamAccess, loadTeamGate } from "@prd-lab/core/repo";
import { auth, signOut } from "@/auth";
import { ProjectsHeader } from "@/components/layout/projects-header";
import { CommandSwitcher } from "@/components/command-switcher";
import { CreateDialog } from "@/components/create-dialog";
import { GlobalHotkeys } from "@/components/global-hotkeys";
import { TeamMembersView } from "@/components/team-members";

type Params = Promise<{ pid: string }>;

/** 项目页「成员」：团队项目的成员可见；添加、改角色、移除只有负责人能做。 */
export default async function ProjectMembersPage({ params }: { params: Params }) {
  const session = await auth();
  const { pid } = await params;
  if (!session?.user?.id) redirect(`/login?callbackUrl=/projects/${pid}/members`);

  const row = await findProjectForRepo(pid);
  if (!row) notFound();
  const access = await getTeamAccess(pid, session.user.id);
  if (!access || !access.enabled || !access.role) notFound();
  const gate = await loadTeamGate(pid);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <ProjectsHeader
        userName={session.user.name ?? "未命名"}
        logoutAction={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      />
      <TeamMembersView project={{ id: pid, name: row.name }} myRole={access.role} ready={gate.ready} />
      <CommandSwitcher />
      <CreateDialog />
      <GlobalHotkeys />
    </div>
  );
}

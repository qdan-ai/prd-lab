import { listAccounts } from "@/lib/auth/accounts";
import { accountPageData } from "@/lib/account-ui/page-data";
import { AccountPage, AccountUnavailable } from "@/components/account/account-page";
import { UsersTable } from "@/components/account/users-table";

export default async function UsersPage() {
  // listAccounts locks and reads the actor's current DB role, even if the JWT still says admin.
  const result = await accountPageData("/admin/users", listAccounts);
  if (!result) return <AccountUnavailable path="/admin/users" />;
  return <AccountPage title="用户管理" userName={result.session.userName}><UsersTable currentUserId={result.session.userId} initialUsers={result.data.map((user) => ({ ...user, createdAt: user.createdAt.toISOString() }))} /></AccountPage>;
}

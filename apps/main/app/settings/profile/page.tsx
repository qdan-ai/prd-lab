import { getAccountProfile } from "@/lib/auth/accounts";
import { accountPageData } from "@/lib/account-ui/page-data";
import { AccountPage, AccountUnavailable } from "@/components/account/account-page";
import { ProfileForm } from "@/components/account/profile-form";

export default async function ProfilePage() {
  const result = await accountPageData("/settings/profile", getAccountProfile);
  if (!result) return <AccountUnavailable path="/settings/profile" />;
  const user = result.data;
  const allowEmptySharedPassword = process.env.NODE_ENV !== "production" && !process.env.AUTH_SHARED_PASSWORD;
  return <AccountPage title="个人资料" userName={user.name}><ProfileForm allowEmptySharedPassword={allowEmptySharedPassword} initialUser={{ ...user, createdAt: user.createdAt.toISOString(), passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null }} /></AccountPage>;
}

import { redirect } from "next/navigation";
import { getAccountProfile } from "@/lib/auth/accounts";
import { accountPageData } from "@/lib/account-ui/page-data";
import { safeCallbackUrl } from "@/lib/account-ui/safe-callback";
import { personalPasswordUrl } from "@/lib/account-ui/personal-password";
import { AccountUnavailable } from "@/components/account/account-page";
import { AccountEntry } from "@/components/account/form-parts";
import { PasswordForm } from "@/components/account/profile-form";

/**
 * /settings/password?callbackUrl=…  Accounts signed in with the team shared password set a personal
 * password here, then continue to callbackUrl. Accounts that already have one go straight on.
 */
export default async function PersonalPasswordPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const path = personalPasswordUrl(callbackUrl);
  const result = await accountPageData(path, getAccountProfile);
  if (!result) return <AccountUnavailable path={path} />;
  if (result.data.passwordMode === "personal") redirect(callbackUrl);
  const allowEmptySharedPassword = process.env.NODE_ENV !== "production" && !process.env.AUTH_SHARED_PASSWORD;
  return <AccountEntry title="设置个人密码">
    <p className="text-[12px] text-ink-500 mb-4 leading-relaxed">你正在使用团队共享密码登录。设置个人密码后继续，之后请用个人密码登录。</p>
    <PasswordForm shared allowEmptySharedPassword={allowEmptySharedPassword} callbackUrl={callbackUrl} />
  </AccountEntry>;
}

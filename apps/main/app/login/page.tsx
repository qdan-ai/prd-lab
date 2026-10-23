import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountEntry } from "@/components/account/form-parts";
import { LoginForm } from "@/components/account/login-form";
import { safeCallbackUrl } from "@/lib/account-ui/safe-callback";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; reauth?: string }> }) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const session = await auth();
  if (session?.user?.id && params.reauth !== "1") redirect(callbackUrl);
  const allowEmptySharedPassword = process.env.NODE_ENV !== "production" && !process.env.AUTH_SHARED_PASSWORD;
  return <AccountEntry title="登录账号"><LoginForm callbackUrl={callbackUrl} allowEmptySharedPassword={allowEmptySharedPassword} /></AccountEntry>;
}

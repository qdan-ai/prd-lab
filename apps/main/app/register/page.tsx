import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountEntry } from "@/components/account/form-parts";
import { RegisterForm } from "@/components/account/register-form";
import { safeCallbackUrl } from "@/lib/account-ui/safe-callback";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const session = await auth();
  if (session?.user?.id) redirect(callbackUrl);
  return <AccountEntry title="注册账号"><RegisterForm callbackUrl={callbackUrl} /></AccountEntry>;
}

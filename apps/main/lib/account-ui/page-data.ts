import { notFound, redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/api/auth-guard";
import { AccountError } from "@/lib/auth/account-errors";
import { accountEntryUrl } from "./safe-callback";

/** The loader must recheck the current DB account (including role), not trust a cached JWT. */
export async function accountPageData<T>(path: string, load: (session: Session) => Promise<T>) {
  let session: Session | null;
  try { session = await getSession(); }
  catch { return null; }
  if (!session) redirect(accountEntryUrl("/login", path));
  try { return { session, data: await load(session) }; }
  catch (error) {
    if (error instanceof AccountError) {
      if (error.code === "not_admin" || error.code === "not_found") notFound();
      if (error.code === "unauthorized") redirect(`${accountEntryUrl("/login", path)}&reauth=1`);
    }
    // Never render raw database or framework error messages in account pages.
    return null;
  }
}

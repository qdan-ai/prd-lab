import { accountEntryUrl, safeCallbackUrl } from "./safe-callback";

/** A shared-password sign-in lands here first; the original destination travels along as callbackUrl. */
export function personalPasswordUrl(callback: unknown): string {
  return `/settings/password?callbackUrl=${encodeURIComponent(safeCallbackUrl(callback))}`;
}

/** After a password update: continue to the destination, or sign in again and then continue. */
export function afterPasswordUpdate(result: { reauthRequired: boolean }, callback: unknown):
  | { continueTo: string }
  | { reauthUrl: string } {
  const destination = safeCallbackUrl(callback);
  return result.reauthRequired
    ? { reauthUrl: `${accountEntryUrl("/login", destination)}&reauth=1` }
    : { continueTo: destination };
}

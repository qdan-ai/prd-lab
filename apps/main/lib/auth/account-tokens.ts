import { apiTokens, generateApiToken } from "@prd-lab/core";
import type { Session } from "@/lib/api/auth-guard";
import { insertReturning } from "@/lib/db/insert-returning";
import { accountTransaction, lockAccountUsers, requireLockedAccountSession } from "./account-session";

/** Both token issuers serialize with password reset, then recheck the requesting credential. */
export async function createAccountToken(session: Session, name: string) {
  const generated = generateApiToken();
  const row = await accountTransaction(async (tx) => {
    const users = await lockAccountUsers(tx, [session.userId]);
    await requireLockedAccountSession(tx, session, users.get(session.userId));
    return insertReturning(tx, apiTokens, {
      userId: session.userId,
      name,
      tokenHash: generated.hash,
      tokenPrefix: generated.prefix,
    });
  });
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    createdAt: row.createdAt,
    plainToken: generated.plain,
  };
}

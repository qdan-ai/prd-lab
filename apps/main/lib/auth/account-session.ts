import { and, eq, isNull } from "drizzle-orm";
import { apiTokens, db, users, type User } from "@prd-lab/core";
import type { Session } from "@/lib/api/auth-guard";
import { AccountError } from "./account-errors";
import { AuthenticationUnavailableError } from "./errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";

export type AccountTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Reset can lock two accounts: always acquire users by stable ID order before any token row. */
export async function lockAccountUsers(tx: AccountTransaction, ids: string[]): Promise<Map<string, User>> {
  const rows = new Map<string, User>();
  for (const id of [...new Set(ids)].sort()) {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1).for("update");
    if (user) rows.set(id, user);
  }
  return rows;
}

/** Call only after locking the actor's users row. A current read is essential under REPEATABLE READ. */
export async function requireLockedAccountSession(tx: AccountTransaction, session: Session, user: User | undefined): Promise<User> {
  if (!user || user.id !== session.userId || user.archivedAt) throw new AccountError("unauthorized");
  if (session.tokenId !== undefined) {
    const [token] = await tx.select({ id: apiTokens.id }).from(apiTokens)
      .where(and(eq(apiTokens.id, session.tokenId), eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
      .limit(1).for("update");
    if (!token) throw new AccountError("unauthorized");
  } else if (!Number.isInteger(session.credentialVersion) || session.credentialVersion !== user.credentialVersion) {
    throw new AccountError("unauthorized");
  }
  return user;
}

/** Map only the two known unique indexes; never guess which field failed or expose SQL. */
export async function accountTransaction<T>(work: (tx: AccountTransaction) => Promise<T>): Promise<T> {
  try { return await db.transaction(work); }
  catch (error) {
    if (error instanceof AccountError || error instanceof AuthenticationUnavailableError) throw error;
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      let current: unknown = error;
      for (let i = 0; i < 6 && current && typeof current === "object"; i++) {
        const e = current as { sqlMessage?: string; cause?: unknown };
        if (e.sqlMessage?.includes("users_name_unique")) throw new AccountError("name_taken", "name_taken", { field: "name" });
        if (e.sqlMessage?.includes("users_email_unique")) throw new AccountError("email_taken", "email_taken", { field: "email" });
        current = e.cause;
      }
    }
    throw new AuthenticationUnavailableError({ cause: error });
  }
}

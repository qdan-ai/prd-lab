import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { apiTokens, hashPassword, users, type User } from "@prd-lab/core";
import type { Session } from "@/lib/api/auth-guard";
import { insertReturning } from "@/lib/db/insert-returning";
import { AccountError } from "./account-errors";
import { parsePasswordChange, parsePasswordReset, parseProfile, parseRegistration } from "./account-input";
import { accountTransaction, lockAccountUsers, requireLockedAccountSession, type AccountTransaction } from "./account-session";
import { verifyAccountPassword } from "./credentials";

export const RESET_PASSWORD = "600109";

export function accountProfile(user: User) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    createdAt: user.createdAt, passwordMode: user.passwordHash === null ? "shared" as const : "personal" as const,
    passwordChangedAt: user.passwordChangedAt,
  };
}

async function actor(tx: AccountTransaction, session: Session) {
  const rows = await lockAccountUsers(tx, [session.userId]);
  return requireLockedAccountSession(tx, session, rows.get(session.userId));
}

export async function registerAccount(body: unknown) {
  const input = parseRegistration(body);
  const passwordHash = await hashPassword(input.password);
  const user = await accountTransaction(async (tx) => {
    const row: User = await insertReturning(tx, users, {
      name: input.name, email: input.email, passwordHash, role: "editor", passwordChangedAt: new Date(),
    });
    return accountProfile(row);
  });
  return { user, password: input.password };
}

export async function getAccountProfile(session: Session) {
  return accountTransaction(async (tx) => accountProfile(await actor(tx, session)));
}

export async function updateAccountProfile(session: Session, body: unknown) {
  const changes = parseProfile(body);
  return accountTransaction(async (tx) => {
    const user = await actor(tx, session);
    await tx.update(users).set(changes).where(eq(users.id, user.id));
    return accountProfile({ ...user, ...changes });
  });
}

function passwordUpdate(passwordHash: string, now: Date) {
  return {
    passwordHash, passwordChangedAt: now, credentialVersion: sql`${users.credentialVersion} + 1`,
    failedLoginCount: 0, loginFailureWindowStartedAt: null, loginLockedUntil: null,
  };
}

export async function changeAccountPassword(session: Session, body: unknown) {
  const input = parsePasswordChange(body);
  return accountTransaction(async (tx) => {
    const user = await actor(tx, session);
    // Login throttling is not applied to this authenticated change-password operation.
    if (!await verifyAccountPassword(input.currentPassword, user.passwordHash)) {
      throw new AccountError("validation_error", "current_password_invalid", { field: "currentPassword" });
    }
    await tx.update(users).set(passwordUpdate(await hashPassword(input.newPassword), new Date())).where(eq(users.id, user.id));
    // Used only by the server-side reauthentication call, never serialized into the response.
    return { identifier: user.name, password: input.newPassword };
  });
}

export async function listAccounts(session: Session) {
  return accountTransaction(async (tx) => {
    const user = await actor(tx, session);
    if (user.role !== "admin") throw new AccountError("not_admin");
    return tx.select({
      id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt,
      passwordMode: sql<"shared" | "personal">`CASE WHEN ${users.passwordHash} IS NULL THEN 'shared' ELSE 'personal' END`,
    }).from(users).where(isNull(users.archivedAt)).orderBy(desc(users.createdAt), desc(users.id));
  });
}

export async function resetAccountPassword(session: Session, targetId: string, body: unknown) {
  const revokeApiTokens = parsePasswordReset(body);
  return accountTransaction(async (tx) => {
    const rows = await lockAccountUsers(tx, [session.userId, targetId]);
    const user = await requireLockedAccountSession(tx, session, rows.get(session.userId));
    if (user.role !== "admin") throw new AccountError("not_admin");
    if (targetId === user.id) throw new AccountError("validation_error", "cannot_reset_self");
    const target = rows.get(targetId);
    if (!target || target.archivedAt) throw new AccountError("not_found");
    const now = new Date();
    await tx.update(users).set(passwordUpdate(await hashPassword(RESET_PASSWORD), now)).where(eq(users.id, targetId));
    if (revokeApiTokens) {
      await tx.update(apiTokens).set({ revokedAt: now }).where(and(eq(apiTokens.userId, targetId), isNull(apiTokens.revokedAt)));
    }
    return { user: { id: target.id, name: target.name, email: target.email }, password: RESET_PASSWORD, apiTokensRevoked: revokeApiTokens };
  });
}

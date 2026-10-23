import { eq } from "drizzle-orm";
import { db, users, verifyPassword } from "@prd-lab/core";
import { verifySharedPassword } from "./shared-password";
import { AuthenticationUnavailableError, LoginLockedError } from "./errors";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_LIMIT = 5;

export type AuthenticatedUser = {
  id: string;
  name: string;
  role: "admin" | "editor";
  credentialVersion: number;
};

/** bcrypt only consumes 72 bytes. Never silently truncate a personal password. */
export function isValidPersonalPassword(value: unknown): value is string {
  return typeof value === "string" && [...value].length >= 6 && Buffer.byteLength(value, "utf8") <= 72;
}

/** Also usable by registration's invite-code check; production never has an empty-config bypass. */
export function verifyAccountSharedPassword(input: string | undefined): boolean {
  const expected = process.env.AUTH_SHARED_PASSWORD ?? "";
  if (!expected && process.env.NODE_ENV === "production") return false;
  return verifySharedPassword(input, expected);
}

export async function verifyAccountPassword(password: unknown, passwordHash: string | null): Promise<boolean> {
  if (passwordHash !== null) {
    return isValidPersonalPassword(password) && verifyPassword(password, passwordHash);
  }
  return verifyAccountSharedPassword(typeof password === "string" ? password : undefined);
}

/**
 * The user row serializes password verification, failure accounting and password changes.
 * Return failed/locked outcomes from the transaction: throwing inside it would roll back the fifth failure.
 */
export async function authenticateCredentials(identifier: unknown, password: unknown): Promise<AuthenticatedUser | null> {
  if (typeof identifier !== "string" || !identifier.trim() || identifier.trim().length > 255) return null;
  const normalized = identifier.trim();
  try {
    const result = await db.transaction<AuthenticatedUser | { lockedUntil: Date } | null>(async (tx) => {
      const [user] = await tx.select().from(users)
        .where(normalized.includes("@") ? eq(users.email, normalized.toLowerCase()) : eq(users.name, normalized))
        .limit(1).for("update");
      if (!user || user.archivedAt) return null;
      // Read the clock after acquiring the lock, not before waiting for concurrent attempts.
      const now = new Date();
      if (user.loginLockedUntil && user.loginLockedUntil > now) {
        return { lockedUntil: user.loginLockedUntil };
      }
      const expired = user.loginLockedUntil !== null || !user.loginFailureWindowStartedAt ||
        now.getTime() - user.loginFailureWindowStartedAt.getTime() >= LOGIN_WINDOW_MS;
      if (await verifyAccountPassword(password, user.passwordHash)) {
        await tx.update(users).set({ failedLoginCount: 0, loginFailureWindowStartedAt: null, loginLockedUntil: null })
          .where(eq(users.id, user.id));
        return { id: user.id, name: user.name, role: user.role, credentialVersion: user.credentialVersion };
      }
      const failedLoginCount = (expired ? 0 : user.failedLoginCount) + 1;
      const loginLockedUntil = failedLoginCount >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_WINDOW_MS) : null;
      await tx.update(users).set({
        failedLoginCount,
        loginFailureWindowStartedAt: expired ? now : user.loginFailureWindowStartedAt,
        loginLockedUntil,
      }).where(eq(users.id, user.id));
      return loginLockedUntil ? { lockedUntil: loginLockedUntil } : null;
    });
    if (result && "lockedUntil" in result) throw new LoginLockedError(result.lockedUntil);
    return result;
  } catch (error) {
    if (error instanceof LoginLockedError) throw error;
    throw new AuthenticationUnavailableError({ cause: error });
  }
}

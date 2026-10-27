import { CredentialsSignin, type NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { eq } from "drizzle-orm";
import { db, users } from "@prd-lab/core";
import { AuthenticationUnavailableError } from "./errors";

export const SESSION_VERIFY_TTL_SECONDS = 60;

/**
 * Claims this app keeps in the Auth.js JWT. Auth.js types the token as an open record, so read and write
 * these fields through this type wherever the token is handled.
 */
export type AccountToken = JWT & {
  userId?: string;
  role?: "admin" | "editor";
  credentialVersion?: number;
  verifiedAt?: number;
  authenticationError?: "authentication_unavailable";
};

export function isCredentialVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export const authCallbacks = {
  async jwt({ token: jwt, user }) {
    const token = jwt as AccountToken;
    // Only authorize's server-side result can establish a version. Ignore session/update input entirely.
    if (user) {
      if (!user.id || !isCredentialVersion(user.credentialVersion)) throw new CredentialsSignin();
      token.userId = user.id;
      token.credentialVersion = user.credentialVersion;
    }
    if (!token.userId || !isCredentialVersion(token.credentialVersion)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (user || token.authenticationError || typeof token.verifiedAt !== "number" ||
      now - token.verifiedAt >= SESSION_VERIFY_TTL_SECONDS) {
      try {
        const [current] = await db.select({
          name: users.name, role: users.role, credentialVersion: users.credentialVersion, archivedAt: users.archivedAt,
        }).from(users).where(eq(users.id, token.userId)).limit(1);
        // In particular, never pair an old password verification with a newly reset version at sign-in.
        if (!current || current.archivedAt || current.credentialVersion !== token.credentialVersion) {
          // Auth.js treats a null sign-in JWT as a successful redirect with a cleared cookie.
          // Throw on new sign-ins so callers cannot report successful reauthentication.
          if (user) throw new CredentialsSignin();
          return null;
        }
        token.name = current.name;
        token.role = current.role;
        token.verifiedAt = now;
        delete token.authenticationError;
      } catch (error) {
        if (error instanceof CredentialsSignin) throw error;
        if (user) throw new AuthenticationUnavailableError({ cause: error });
        // Auth.js swallows thrown JWT callback errors and clears the cookie. Preserve the claims for retry,
        // but expose NO authenticated user until a DB recheck succeeds. Do not advance verifiedAt.
        token.authenticationError = "authentication_unavailable";
      }
    }
    return token;
  },
  session({ session, token: jwt }) {
    const token = jwt as AccountToken;
    if (token.authenticationError) {
      session.error = token.authenticationError;
      session.user = undefined!;
    } else if (token.userId && isCredentialVersion(token.credentialVersion) &&
      (token.role === "admin" || token.role === "editor")) {
      session.user = { ...session.user, id: token.userId, name: token.name, role: token.role,
        credentialVersion: token.credentialVersion };
      delete session.error;
    } else {
      session.user = undefined!;
    }
    return session;
  },
} satisfies NonNullable<NextAuthConfig["callbacks"]>;

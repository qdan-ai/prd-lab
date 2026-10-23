import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: "admin" | "editor";
    credentialVersion?: number;
  }
  interface Session {
    error?: "authentication_unavailable";
    user: {
      id: string;
      role?: "admin" | "editor";
      credentialVersion?: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: "admin" | "editor";
    credentialVersion?: number;
    verifiedAt?: number;
    authenticationError?: "authentication_unavailable";
  }
}

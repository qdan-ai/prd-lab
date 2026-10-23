import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticateCredentials } from "@/lib/auth/credentials";
import { authCallbacks } from "@/lib/auth/session";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SEVEN_DAYS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Account",
      credentials: {
        identifier: { label: "用户名或邮箱", type: "text" },
        password: { label: "密码", type: "password" },
      },
      authorize: (credentials) => authenticateCredentials(credentials?.identifier, credentials?.password),
    }),
  ],
  callbacks: authCallbacks,
});

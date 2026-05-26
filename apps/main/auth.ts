import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db, users } from "@prd-lab/core";
import { upsertUserByName } from "@/lib/auth/upsert";
import { verifySharedPassword } from "@/lib/auth/shared-password";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const VERIFY_TTL_SECONDS = 60; // 每 60s lazy 验证 token.userId 仍存在

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SEVEN_DAYS },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Name",
      credentials: {
        name: { label: "姓名", type: "text" },
        password: { label: "团队密码", type: "password" },
      },
      authorize: async (credentials) => {
        // S15 门禁：env 未设跳过；env 设了必须匹配
        const expected = process.env.AUTH_SHARED_PASSWORD ?? "";
        const input = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!verifySharedPassword(input, expected)) return null;

        const raw = typeof credentials?.name === "string" ? credentials.name : "";
        const user = await upsertUserByName(raw);
        if (!user) return null;
        return { id: user.id, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // 登入路径：authorize() 已写入 users，trust user
      if (user) {
        token.userId = user.id as string;
        token.name = user.name;
        token.verifiedAt = Math.floor(Date.now() / 1000);
        return token;
      }
      // 后续每次 request：60s TTL lazy verify users 表里仍有该用户
      // 防止 dev 环境下 DB 被 truncate / 用户被外部删，但 JWT 仍持有旧 user.id 触发 FK violation
      if (token.userId) {
        const now = Math.floor(Date.now() / 1000);
        const verifiedAt = (token.verifiedAt as number | undefined) ?? 0;
        if (now - verifiedAt > VERIFY_TTL_SECONDS) {
          try {
            const rows = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, token.userId as string))
              .limit(1);
            if (rows.length === 0) {
              delete token.userId;
              delete token.name;
              delete token.verifiedAt;
            } else {
              token.verifiedAt = now;
            }
          } catch {
            // DB 抖动时不让用户瞬间退出；下个 request 再试
          }
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
});

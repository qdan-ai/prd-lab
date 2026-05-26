import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { apiTokens, db, hashApiToken, users } from "@prd-lab/core";
import { auth } from "@/auth";

export type Session = {
  userId: string;
  userName: string;
  /** 走 Bearer api_token 路径时为 token id；NextAuth 浏览器路径下不存在。 */
  tokenId?: string;
};

/**
 * 拿当前 session；未登入返回 null（调用方应返回 401）。
 *
 * S6 起优先校验 `Authorization: Bearer prd_*`（查 api_tokens 表 + 更新
 * last_used_at），失败回退到 NextAuth session（浏览器 cookie 路径）。
 * 撤销态（revoked_at NOT NULL）一律视为未登入。
 */
export async function getSession(): Promise<Session | null> {
  const bearer = await tryBearerSession();
  if (bearer) return bearer;

  const session = await auth();
  if (!session?.user?.id || !session.user.name) return null;
  return { userId: session.user.id, userName: session.user.name };
}

async function tryBearerSession(): Promise<Session | null> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    return null;
  }
  const authz = h.get("authorization");
  if (!authz?.startsWith("Bearer ")) return null;
  const plain = authz.slice(7).trim();
  if (!plain.startsWith("prd_")) return null;

  let hash: string;
  try {
    hash = hashApiToken(plain);
  } catch {
    return null;
  }

  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      userId: apiTokens.userId,
      revokedAt: apiTokens.revokedAt,
      userName: users.name,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);

  if (!row || row.revokedAt) return null;

  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.tokenId));

  return { userId: row.userId, userName: row.userName, tokenId: row.tokenId };
}

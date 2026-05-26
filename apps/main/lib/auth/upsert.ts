import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@prd-lab/core";

/**
 * 按姓名 upsert user。并发安全（MySQL 5.7）：
 * 1. INSERT ... ON DUPLICATE KEY UPDATE name = name（no-op）→ 已存在则什么也不改
 * 2. SELECT by name → 拿到刚插入的或已存在的行
 *
 * 重名兜底完全靠 DB 唯一约束（users.name UNIQUE）。
 */
export async function upsertUserByName(rawName: string): Promise<{
  id: string;
  name: string;
} | null> {
  const name = rawName.trim();
  if (!name) return null;
  if (name.length > 64) return null;

  await db
    .insert(users)
    .values({ id: randomUUID(), name })
    .onDuplicateKeyUpdate({ set: { name: sql`${users.name}` } });

  const existing = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.name, name))
    .limit(1);

  return existing[0] ?? null;
}

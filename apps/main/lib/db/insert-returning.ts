import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

/**
 * MySQL 不支持 .returning()。统一改写：先生成 uuid → insert → select by id。
 *
 * 适用于含 `id varchar(36) PRIMARY KEY` 的表（projects / versions / snapshots /
 * snapshot_files / users / api_tokens）。share_links 主键由调用方传入也兼容
 * （传入的 id 会被沿用而非生成新的）。
 *
 * 使用方式：
 *   const row = await insertReturning(tx, projects, { name, ownerId, ... });
 *   // row 是 inferSelect 类型，含 createdAt 等 db 默认值
 */
export async function insertReturning<TTable extends { id: unknown }>(
  txOrDb: any,
  table: TTable,
  values: Record<string, unknown>,
): Promise<any> {
  const id = (values.id as string | undefined) ?? randomUUID();
  await txOrDb.insert(table).values({ ...values, id });
  const idCol = (table as { id: any }).id;
  const rows = await txOrDb.select().from(table).where(eq(idCol, id));
  const row = rows[0];
  if (!row) throw new Error(`insert succeeded but row not found: id=${id}`);
  return row;
}

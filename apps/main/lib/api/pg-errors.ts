/**
 * MySQL 错误码识别。
 *
 * S14 起项目改用 MySQL 5.7 + mysql2 驱动。常量名保留 PG_* 前缀作为 legacy 兼容，
 * 但取值已切换到 mysql2 抛出的 errno（数字）。
 *
 * Drizzle ORM 在 query 失败时把 mysql2 抛出的原始错误包装成新 Error，
 * 顶层 errno 字段可能丢失，真实 errno 在 `.cause` 链上。
 * 因此 isPgError 必须遍历 `.cause` 链匹配 errno（或 code 字符串）。
 *
 * mysql2 错误对象典型字段：
 *   { code: "ER_DUP_ENTRY", errno: 1062, sqlState: "23000", sqlMessage: "..." }
 */

// 取值切换到 mysql2 errno；常量名保留 PG_* 仅为 legacy import 兼容
export const PG_UNIQUE_VIOLATION = 1062; // ER_DUP_ENTRY
export const PG_FOREIGN_KEY_VIOLATION = 1452; // ER_NO_REFERENCED_ROW_2 (insert/update 时父表无记录)
export const PG_LOCK_NOT_AVAILABLE = 1205; // ER_LOCK_WAIT_TIMEOUT
export const PG_DEADLOCK = 1213; // ER_LOCK_DEADLOCK
export const PG_CHECK_VIOLATION = 3819; // ER_CHECK_CONSTRAINT_VIOLATED（MySQL 5.7 不强制 CHECK，仅 8.0+ 才会触发）

/** 检查 error（含 cause 链）是否携带指定 MySQL errno（或 mysql2 code 字符串）。 */
export function isPgError(e: unknown, code: number | string): boolean {
  let cur: unknown = e;
  // 防御循环引用，最多 6 层
  for (let i = 0; i < 6 && cur != null; i++) {
    if (typeof cur === "object" && cur !== null) {
      const obj = cur as { code?: unknown; errno?: unknown };
      if (typeof code === "number" && typeof obj.errno === "number" && obj.errno === code) {
        return true;
      }
      if (typeof code === "string" && typeof obj.code === "string" && obj.code === code) {
        return true;
      }
    }
    cur = typeof cur === "object" && cur !== null ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

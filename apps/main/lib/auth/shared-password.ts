import { timingSafeEqual } from "node:crypto";

/**
 * 团队共享登入密码门禁（S15）。
 *
 * 行为：
 * - expected 为空（"" / undefined）→ 跳过校验返回 true（dev 豁免）
 * - input 缺失或类型不对 → false
 * - 长度不等 → false（必须先短路，否则 timingSafeEqual 抛 RangeError）
 * - 长度相等 → 走 timingSafeEqual 常时间比较防侧信道
 */
export function verifySharedPassword(
  input: string | undefined,
  expected: string,
): boolean {
  if (!expected) return true;
  if (typeof input !== "string") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

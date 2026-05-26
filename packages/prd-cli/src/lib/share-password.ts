import { randomInt } from "node:crypto";

/**
 * 生成 6 位纯数字密码，前导补零（"012345" 也是合法 6 位）。
 *
 * 用 crypto.randomInt 拿到 [0, 1_000_000) 区间内均匀随机整数，
 * entropy ≈ 19.93 bits。组合上限 100 万，配合后端 5/15min 限流和撤销机制使用。
 */
export function generateSharePassword(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

import bcrypt from "bcryptjs";

/**
 * S5 引入：分享链接密码哈希。
 * 使用 bcryptjs（纯 JS 实现，无 native build；cost 10 在 60-100ms 区间）。
 * 限流由 share_link_attempts 表负责（5 失败/15min 锁定期不进 bcrypt）。
 */

const BCRYPT_COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

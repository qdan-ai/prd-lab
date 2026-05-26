import { createHash, timingSafeEqual } from "node:crypto";
import { customAlphabet } from "nanoid";

/**
 * S6 引入：CLI / MCP API token。
 *
 * 明文格式：prd_ + 32 字符 base32 URL-safe（排除歧义字符 0OIl1）；
 * token_prefix：明文前 12 字符（prd_xxxxxxxx），DB 存供 `prd auth list` 显示；
 * token_hash：sha256(AUTH_SECRET || ':' || plain) hex；
 *
 * 用 sha256 而非 bcrypt：token 已 128bit+ 随机不需要 KDF；API 每请求校验需 µs 级。
 * 与密码（bcrypt）区别对待。AUTH_SECRET 作 pepper 防 DB 泄露后离线彩虹表。
 */

const URL_SAFE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz_-";
const TOKEN_BODY_LENGTH = 32;
const TOKEN_PREFIX_LENGTH = 12;
const PLAIN_PREFIX = "prd_";

const generateBody = customAlphabet(URL_SAFE_ALPHABET, TOKEN_BODY_LENGTH);

export interface GeneratedApiToken {
  /** 明文 token（仅创建瞬间返一次） */
  plain: string;
  /** sha256 hash hex（落 DB token_hash 列） */
  hash: string;
  /** 明文前 12 字符（落 DB token_prefix 列） */
  prefix: string;
}

export function generateApiToken(): GeneratedApiToken {
  const plain = PLAIN_PREFIX + generateBody();
  return {
    plain,
    hash: hashApiToken(plain),
    prefix: plain.slice(0, TOKEN_PREFIX_LENGTH),
  };
}

export function hashApiToken(plain: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET env required for hashApiToken");
  }
  return createHash("sha256").update(`${secret}:${plain}`).digest("hex");
}

/** Constant-time 比较，防 timing 攻击。 */
export function verifyApiToken(plain: string, hash: string): boolean {
  const computed = hashApiToken(plain);
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

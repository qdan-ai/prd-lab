import { customAlphabet } from "nanoid";

/**
 * 生成 share_links.id（URL-safe，长度 32，排除歧义字符 0OIl1）。
 *
 * 32 char × ~57 entropy bits ≈ 182 bits 远超分享场景需求。
 * 显式 alphabet 而非默认 nanoid，确保人眼复制无歧义。
 */

const URL_SAFE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz_-";
const SHARE_ID_LENGTH = 32;

const generate = customAlphabet(URL_SAFE_ALPHABET, SHARE_ID_LENGTH);

export function generateShareId(): string {
  return generate();
}

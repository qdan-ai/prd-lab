import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 访客 session cookie（S5 引入；S9 后精简）：自签 HMAC，无需 server-side session 表。
 *
 * 格式：base64url(payload).sig
 *   payload = JSON.stringify({sid, pv, exp})
 *   sig     = base64url(HMAC-SHA256(payload, AUTH_SECRET))
 *
 * pv 是签发时刻的 share_links.password_version；每请求 verify 后再与 DB 当前 pv 比对，
 * 不一致即视为失效（owner 重置密码 → pv++ → 旧 cookie 全员立即失效）。
 *
 * 旧 payload（含 name/email）verify 时被自动忽略额外字段，无需访客重登。
 *
 * cookie 设置位置：HttpOnly + SameSite=Lax + Path=/share/${shareId} + Secure（生产环境）
 */

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600; // 7d

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET required for share cookie");
  return secret;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

export type ShareCookiePayload = {
  sid: string; // share_links.id
  pv: number; // password_version 签发时刻
  exp: number; // unix seconds
};

export function issueShareCookie(
  input: { shareId: string; pv: number },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const body: ShareCookiePayload = {
    sid: input.shareId,
    pv: input.pv,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadEncoded = base64urlEncode(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  return `${payloadEncoded}.${base64urlEncode(sig)}`;
}

export type VerifyShareCookieResult =
  | { valid: true; expired: false; payload: ShareCookiePayload }
  | { valid: false; expired: false; reason: "malformed" | "bad_signature" }
  | { valid: false; expired: true; payload: ShareCookiePayload };

export function verifyShareCookie(value: string): VerifyShareCookieResult {
  const parts = value.split(".");
  if (parts.length !== 2) return { valid: false, expired: false, reason: "malformed" };
  const payloadEncoded = parts[0]!;
  const sigEncoded = parts[1]!;

  const expectedSig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(sigEncoded);
  } catch {
    return { valid: false, expired: false, reason: "malformed" };
  }
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return { valid: false, expired: false, reason: "bad_signature" };
  }

  let raw: Partial<ShareCookiePayload>;
  try {
    raw = JSON.parse(base64urlDecode(payloadEncoded).toString("utf8"));
  } catch {
    return { valid: false, expired: false, reason: "malformed" };
  }

  // 旧 payload 可能含 name/email 等额外字段；只校验当前必需字段，多余字段忽略
  if (
    typeof raw.sid !== "string" ||
    typeof raw.pv !== "number" ||
    typeof raw.exp !== "number"
  ) {
    return { valid: false, expired: false, reason: "malformed" };
  }
  const payload: ShareCookiePayload = {
    sid: raw.sid,
    pv: raw.pv,
    exp: raw.exp,
  };

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, expired: true, payload };
  }

  return { valid: true, expired: false, payload };
}

/**
 * 生成 share session id 字符串（用作 preview HMAC token 的 sub 字段）。
 * 格式 `${shareId}:${pv}` —— pv 变化时 token sub 不再匹配；可用于 audit log。
 */
export function shareSessionId(shareId: string, pv: number): string {
  return `${shareId}:${pv}`;
}

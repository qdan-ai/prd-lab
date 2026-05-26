import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC token 用于 preview 域跨域授权（5min 硬过期 + 4min 父窗口续签）。
 *
 * 格式：base64url(payload).sig
 *   payload = JSON.stringify({snapshotId, sub, exp, kind?})
 *   sig     = base64url(HMAC-SHA256(payload, HMAC_SECRET))
 *
 * exp 是 Unix 秒；verifyToken 同时校验 snapshotId 防"用 A 的 token 访 B 的资源"。
 *
 * kind 区分签发主体（S5 引入）：
 *   - 'user'  ：owner / 内部协作者 session，sub = users.id
 *   - 'share' ：访客 session，sub = `${share_id}:${pv}` 形态（pv 失效则 token 同步失效）
 * 老 token（S2-S4 签发）无 kind 字段，verifyToken 解出后默认视为 'user' 兼容。
 */

const DEFAULT_TTL_SECONDS = 300;

function getSecret(): string {
  const secret = process.env.HMAC_SECRET;
  if (!secret) throw new Error("HMAC_SECRET required");
  return secret;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

export type TokenKind = "user" | "share";

export type TokenPayload = {
  snapshotId: string;
  sub: string; // user.id 或 `${share_id}:${pv}`
  exp: number; // unix seconds
  kind: TokenKind; // 解出老 token 缺省视为 'user'
};

function signPayload(body: Omit<TokenPayload, "exp"> & { exp: number }): string {
  const payloadEncoded = base64urlEncode(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  return `${payloadEncoded}.${base64urlEncode(sig)}`;
}

export function issueToken(
  payload: { snapshotId: string; sessionUserId: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  return signPayload({
    snapshotId: payload.snapshotId,
    sub: payload.sessionUserId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: "user",
  });
}

export function issueShareToken(
  payload: { snapshotId: string; shareSessionId: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  return signPayload({
    snapshotId: payload.snapshotId,
    sub: payload.shareSessionId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: "share",
  });
}

export type VerifyResult =
  | { valid: true; expired: false; payload: TokenPayload }
  | { valid: false; expired: false; reason: "malformed" | "bad_signature" | "snapshot_mismatch" }
  | { valid: false; expired: true; payload: TokenPayload };

export function verifyToken(token: string, expectedSnapshotId: string): VerifyResult {
  const parts = token.split(".");
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
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return { valid: false, expired: false, reason: "bad_signature" };
  }

  let raw: Partial<TokenPayload>;
  try {
    raw = JSON.parse(base64urlDecode(payloadEncoded).toString("utf8"));
  } catch {
    return { valid: false, expired: false, reason: "malformed" };
  }

  if (
    typeof raw.snapshotId !== "string" ||
    typeof raw.sub !== "string" ||
    typeof raw.exp !== "number"
  ) {
    return { valid: false, expired: false, reason: "malformed" };
  }
  const payload: TokenPayload = {
    snapshotId: raw.snapshotId,
    sub: raw.sub,
    exp: raw.exp,
    kind: raw.kind === "share" ? "share" : "user", // 老 token 无 kind 字段视为 'user'
  };

  if (payload.snapshotId !== expectedSnapshotId) {
    return { valid: false, expired: false, reason: "snapshot_mismatch" };
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, expired: true, payload };
  }

  return { valid: true, expired: false, payload };
}

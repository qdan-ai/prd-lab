import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC token 用于 preview 域跨域授权。
 *
 * 格式：base64url(payload).sig
 *   payload = JSON.stringify({snapshotId, sub, exp, kind?, origin?})
 *   sig     = base64url(HMAC-SHA256(payload, HMAC_SECRET))
 *
 * exp 是 Unix 秒；verifyToken 同时校验 snapshotId 防"用 A 的 token 访 B 的资源"。
 *
 * kind 区分签发主体（S5 引入）：
 *   - 'user'  ：owner / 内部协作者 session，sub = users.id
 *   - 'share' ：访客 session，sub = `${share_id}:${pv}` 形态（pv 失效则 token 同步失效）
 * 老 token（S2-S4 签发）无 kind 字段，verifyToken 解出后默认视为 'user' 兼容。
 *
 * S20 三层时长解耦（替代 S9 前"5min 硬过期 + 4min 父窗口续签"，后者在 window.open
 * 形态下已实际失效）：
 *   - 查询串交接 token：PREVIEW_HANDOFF_TTL_SECONDS（300s），URL 泄漏窗口不放大
 *   - 预览站 cookie 内会话 token：PREVIEW_SESSION_TTL_SECONDS（12h），由预览站收到
 *     有效交接 token 后用 `reissueToken` 重签
 *   - cookie Max-Age：PREVIEW_COOKIE_MAX_AGE_SECONDS（30d），故意长于 token——token
 *     过期后 cookie 仍在，其 HMAC 保护的 payload（kind / sub / origin）提供上下文，
 *     让预览站能把 document 导航 302 到主站/分享页的 preview-refresh 端点自动重签。
 *
 * origin 是签发时主站请求的 origin（`new URL(request.url).origin`），受 HMAC 签名保护，
 * 预览站可信任其作为重定向目标；缺失（老 token）时走友好 401 兜底页。
 */

const DEFAULT_TTL_SECONDS = 300;

/** 查询串交接 token TTL：300s（URL 会被 shell 的 history.replaceState 抹掉） */
export const PREVIEW_HANDOFF_TTL_SECONDS = 300;

/** 预览站 cookie 内会话 token TTL：12h */
export const PREVIEW_SESSION_TTL_SECONDS = 43200;

/** 预览 cookie Max-Age：30d（故意长于 token，过期 payload 用于自动重签） */
export const PREVIEW_COOKIE_MAX_AGE_SECONDS = 2592000;

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
  /** S20：签发方主站 origin，用于预览站过期后 302 回重签端点；老 token 无此字段 */
  origin?: string;
};

function signPayload(body: TokenPayload | RepoTokenPayload): string {
  const payloadEncoded = base64urlEncode(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  return `${payloadEncoded}.${base64urlEncode(sig)}`;
}

export function issueToken(
  payload: { snapshotId: string; sessionUserId: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  return signPayload({
    snapshotId: payload.snapshotId,
    sub: payload.sessionUserId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: "user",
    // 不传 origin 时 payload 不含该字段（与老 token 完全同形）
    ...(payload.origin ? { origin: payload.origin } : {}),
  });
}

export function issueShareToken(
  payload: { snapshotId: string; shareSessionId: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  return signPayload({
    snapshotId: payload.snapshotId,
    sub: payload.shareSessionId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: "share",
    ...(payload.origin ? { origin: payload.origin } : {}),
  });
}

/**
 * S20：用已验签的 payload 重签一枚新 TTL 的 token（保 snapshotId / sub / kind / origin，只刷 exp）。
 * 预览站换 cookie 时用它把 300s 交接 token 升级成 12h 会话 token。
 */
export function reissueToken(payload: TokenPayload, ttlSeconds: number): string {
  return signPayload({
    snapshotId: payload.snapshotId,
    sub: payload.sub,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: payload.kind,
    ...(payload.origin ? { origin: payload.origin } : {}),
  });
}

export type VerifyResult =
  | { valid: true; expired: false; payload: TokenPayload }
  | { valid: false; expired: false; reason: "malformed" | "bad_signature" | "snapshot_mismatch" }
  | { valid: false; expired: true; payload: TokenPayload };

/** 验签并解出原始 payload；快照令牌与仓库令牌共用。 */
function decodeSigned(
  token: string,
): { ok: true; raw: Record<string, unknown> } | { ok: false; reason: "malformed" | "bad_signature" } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const payloadEncoded = parts[0]!;
  const sigEncoded = parts[1]!;

  const expectedSig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(sigEncoded);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    providedSig.length !== expectedSig.length ||
    !timingSafeEqual(providedSig, expectedSig)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  try {
    const raw: unknown = JSON.parse(base64urlDecode(payloadEncoded).toString("utf8"));
    if (typeof raw !== "object" || raw === null) return { ok: false, reason: "malformed" };
    return { ok: true, raw: raw as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function verifyToken(token: string, expectedSnapshotId: string): VerifyResult {
  const decoded = decodeSigned(token);
  if (!decoded.ok) return { valid: false, expired: false, reason: decoded.reason };
  const raw = decoded.raw as Partial<TokenPayload>;

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
    // 老 token 无 origin 字段；只有字符串才带上，避免污染 payload
    ...(typeof raw.origin === "string" ? { origin: raw.origin } : {}),
  };

  if (payload.snapshotId !== expectedSnapshotId) {
    return { valid: false, expired: false, reason: "snapshot_mismatch" };
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, expired: true, payload };
  }

  return { valid: true, expired: false, payload };
}

// ---- 仓库级令牌（repo-push）----
//
// 作用对象是整个仓库项目（预览站 /r/<repoId>/…），payload 用 repoId 代替 snapshotId：
//   { repoId, sub, exp, kind, origin? }
// 与快照令牌同一密钥、同一编码，但互不通用：仓库令牌没有 snapshotId，verifyToken 判 malformed；
// 快照令牌没有 repoId，verifyRepoToken 判 malformed。

export type RepoTokenPayload = {
  repoId: string;
  sub: string; // user.id 或 `${share_id}:${pv}`
  exp: number;
  kind: TokenKind;
  origin?: string;
};

export type VerifyRepoResult =
  | { valid: true; expired: false; payload: RepoTokenPayload }
  | { valid: false; expired: false; reason: "malformed" | "bad_signature" | "repo_mismatch" }
  | { valid: false; expired: true; payload: RepoTokenPayload };

export function issueRepoToken(
  payload: { repoId: string; sessionUserId: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  return signPayload({
    repoId: payload.repoId,
    sub: payload.sessionUserId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: "user",
    ...(payload.origin ? { origin: payload.origin } : {}),
  });
}

export function issueRepoShareToken(
  payload: { repoId: string; shareSessionId: string; origin?: string },
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  return signPayload({
    repoId: payload.repoId,
    sub: payload.shareSessionId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: "share",
    ...(payload.origin ? { origin: payload.origin } : {}),
  });
}

/** 预览站换 cookie 时把交接令牌重签成会话令牌（保 repoId / sub / kind / origin，只刷 exp）。 */
export function reissueRepoToken(payload: RepoTokenPayload, ttlSeconds: number): string {
  return signPayload({
    repoId: payload.repoId,
    sub: payload.sub,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    kind: payload.kind,
    ...(payload.origin ? { origin: payload.origin } : {}),
  });
}

export function verifyRepoToken(token: string, expectedRepoId: string): VerifyRepoResult {
  const decoded = decodeSigned(token);
  if (!decoded.ok) return { valid: false, expired: false, reason: decoded.reason };
  const raw = decoded.raw;

  if (
    typeof raw.repoId !== "string" ||
    typeof raw.sub !== "string" ||
    typeof raw.exp !== "number" ||
    (raw.kind !== "user" && raw.kind !== "share")
  ) {
    return { valid: false, expired: false, reason: "malformed" };
  }
  const payload: RepoTokenPayload = {
    repoId: raw.repoId,
    sub: raw.sub,
    exp: raw.exp,
    kind: raw.kind,
    ...(typeof raw.origin === "string" ? { origin: raw.origin } : {}),
  };

  if (payload.repoId !== expectedRepoId) {
    return { valid: false, expired: false, reason: "repo_mismatch" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, expired: true, payload };
  }
  return { valid: true, expired: false, payload };
}

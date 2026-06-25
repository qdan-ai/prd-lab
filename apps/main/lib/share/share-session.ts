import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  shareLinks,
  verifyShareCookie,
  snapshots,
  versions,
  projects,
} from "@prd-lab/core";

/**
 * S5 访客 session 校验（S8 改 snapshot 级）。
 *
 * cookie 名：`prd_share_${shareId}`（path=/share/${shareId}，HttpOnly，SameSite=Lax）
 *
 * 校验流程（每请求，顺序不可乱）：
 *   1. 查 DB share 行（含 passwordHash）
 *   2. 不存在 / snapshot/version/project archived → not_found
 *   3. revoked_at NOT NULL → revoked（先于无密码放行；撤销的无密码链接也要 410）
 *   4. passwordHash 为 null（无密码）→ ok（完全不读 cookie）
 *   5. 有密码：cookie 缺失 / hmac 不通 / 过期 → invalid
 *   6.        cookie.sid !== shareId → invalid（防 cookie 跨 share 注入）
 *   7.        cookie.pv !== db.password_version → invalid（密码已重置）
 *   8.        → ok：返回 share 元数据 + cookie payload
 */
export type ShareSessionOk = {
  kind: "ok";
  shareId: string;
  snapshotId: string;
  pv: number;
};

export type ShareSessionInvalid = { kind: "invalid"; reason?: string };
export type ShareSessionNotFound = { kind: "not_found" };
export type ShareSessionRevoked = { kind: "revoked" };
export type ShareSessionResult =
  | ShareSessionOk
  | ShareSessionInvalid
  | ShareSessionNotFound
  | ShareSessionRevoked;

export function shareCookieName(shareId: string): string {
  return `prd_share_${shareId}`;
}

export async function getShareSession(shareId: string): Promise<ShareSessionResult> {
  // 1. 查 DB share 行（含 passwordHash，无密码判定的唯一依据）
  const rows = await db
    .select({
      id: shareLinks.id,
      snapshotId: shareLinks.snapshotId,
      passwordHash: shareLinks.passwordHash,
      passwordVersion: shareLinks.passwordVersion,
      revokedAt: shareLinks.revokedAt,
      snapshotArchivedAt: snapshots.archivedAt,
    })
    .from(shareLinks)
    .innerJoin(snapshots, eq(shareLinks.snapshotId, snapshots.id))
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(shareLinks.id, shareId), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const row = rows[0];

  // 2. 不存在 / snapshot archived → not_found
  if (!row) return { kind: "not_found" };
  if (row.snapshotArchivedAt !== null) return { kind: "not_found" };

  // 3. 已撤销 → revoked（必须先于无密码放行，撤销的无密码链接也要拦）
  if (row.revokedAt !== null) return { kind: "revoked" };

  // 4. 无密码 → 直接放行，完全不读 cookie
  if (row.passwordHash === null) {
    return { kind: "ok", shareId, snapshotId: row.snapshotId, pv: row.passwordVersion };
  }

  // 5. 有密码：读 cookie，无 / 签名失败 / 过期 → invalid
  const cookieStore = await cookies();
  const cookie = cookieStore.get(shareCookieName(shareId));
  if (!cookie) return { kind: "invalid", reason: "no_cookie" };

  const verify = verifyShareCookie(cookie.value);
  if (!verify.valid) {
    return { kind: "invalid", reason: verify.expired ? "expired" : verify.reason };
  }

  // 6. cookie.sid !== shareId → invalid（防 cookie 跨 share 注入，不可删）
  if (verify.payload.sid !== shareId) {
    return { kind: "invalid", reason: "share_id_mismatch" };
  }

  // 7. cookie.pv !== db.password_version → invalid（密码已重置）
  if (row.passwordVersion !== verify.payload.pv) {
    return { kind: "invalid", reason: "pv_mismatch" };
  }

  // 8. 全部通过 → ok
  return {
    kind: "ok",
    shareId,
    snapshotId: row.snapshotId,
    pv: row.passwordVersion,
  };
}

/**
 * 从请求中提取访客 IP（用于限流；nginx 反代后 X-Forwarded-For 优先）。
 * 失败兜底为 "0.0.0.0"（不阻止限流逻辑跑，但相当于一个 IP 全局共享）。
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}

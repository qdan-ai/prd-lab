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
 * 校验流程（每请求）：
 *   1. cookie 缺失 / hmac 不通 / 过期 → invalid
 *   2. cookie.sid !== shareId → invalid（防 cookie 跨 share 注入）
 *   3. share_links 不存在 → not_found
 *   4. share_links.revoked_at NOT NULL → revoked
 *   5. cookie.pv !== db.password_version → invalid（密码已重置）
 *   6. snapshot/version/project archived → not_found
 *   → ok：返回 share 元数据 + cookie payload
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
  const cookieStore = await cookies();
  const cookie = cookieStore.get(shareCookieName(shareId));
  if (!cookie) return { kind: "invalid", reason: "no_cookie" };

  const verify = verifyShareCookie(cookie.value);
  if (!verify.valid) {
    return { kind: "invalid", reason: verify.expired ? "expired" : verify.reason };
  }
  if (verify.payload.sid !== shareId) {
    return { kind: "invalid", reason: "share_id_mismatch" };
  }

  const rows = await db
    .select({
      id: shareLinks.id,
      snapshotId: shareLinks.snapshotId,
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
  if (!row) return { kind: "not_found" };
  if (row.revokedAt !== null) return { kind: "revoked" };
  if (row.snapshotArchivedAt !== null) return { kind: "not_found" };
  if (row.passwordVersion !== verify.payload.pv) {
    return { kind: "invalid", reason: "pv_mismatch" };
  }

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

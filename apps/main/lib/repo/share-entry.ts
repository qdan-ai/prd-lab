import { issueRepoToken, issueRepoShareToken, PREVIEW_HANDOFF_TTL_SECONDS, shareSessionId } from "@prd-lab/core";
import { repoProjectIdOfVersion } from "@prd-lab/core/repo";
import { previewOrigin } from "@/lib/repo/route-helpers";

/**
 * 分享链接一路带着走的版本参数：`v`（人用的版本号）与 `k`（锁版本链接的版本 key）。
 * 分享页 → 密码页 → 回内容页 → 预览站，每一跳都原样转交；返回 `?…` 或空串。
 */
export function versionQuery(v: string | null | undefined, k: string | null | undefined): string {
  const q = new URLSearchParams();
  if (v) q.set("v", v);
  if (k) q.set("k", k);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * 访客打开项目级分享链接：链接绑定的方案是某仓库的系统方案时，签仓库级访客令牌并给出
 * 预览站查看器入口 `/r/<pid>?token=…[&v=…][&k=…]`（`v`、`k` 原样转交，由预览站解析落到哪一版）。
 * 不是仓库项目返回 null，分享页照旧渲染方案级文件列表。
 *
 * 调用前提：分享会话已校验通过（密码 / 撤销 / 归档）。
 */
export async function repoShareEntryUrl(input: {
  shareId: string;
  versionId: string;
  pv: number;
  /** Authorized private account from getShareSession; absent for team shares. */
  userId?: string;
  origin: string | null;
  v: string | null;
  k: string | null;
}): Promise<string | null> {
  const repoId = await repoProjectIdOfVersion(input.versionId);
  if (!repoId) return null;
  const token = input.userId ? issueRepoToken(
    { repoId, sessionUserId: input.userId, ...(input.origin ? { origin: input.origin } : {}) },
    PREVIEW_HANDOFF_TTL_SECONDS,
  ) : issueRepoShareToken(
    {
      repoId,
      shareSessionId: shareSessionId(input.shareId, input.pv),
      ...(input.origin ? { origin: input.origin } : {}),
    },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  const query = new URLSearchParams({ token });
  if (input.v) query.set("v", input.v);
  if (input.k) query.set("k", input.k);
  return `${previewOrigin()}/r/${repoId}?${query.toString()}`;
}

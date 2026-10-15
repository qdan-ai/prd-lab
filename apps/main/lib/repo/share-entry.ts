import { issueRepoShareToken, PREVIEW_HANDOFF_TTL_SECONDS, shareSessionId } from "@prd-lab/core";
import { repoProjectIdOfVersion } from "@prd-lab/core/repo";
import { previewOrigin } from "@/lib/repo/route-helpers";

/**
 * 访客打开项目级分享链接：链接绑定的方案是某仓库的系统方案时，签仓库级访客令牌并给出
 * 预览站查看器入口 `/r/<pid>/?token=…[&v=…]`（`v` 原样转交，由预览站解析落到哪一版）。
 * 不是仓库项目返回 null，分享页照旧渲染方案级文件列表。
 *
 * 调用前提：分享会话已校验通过（密码 / 撤销 / 归档）。
 */
export async function repoShareEntryUrl(input: {
  shareId: string;
  versionId: string;
  pv: number;
  origin: string | null;
  v: string | null;
}): Promise<string | null> {
  const repoId = await repoProjectIdOfVersion(input.versionId);
  if (!repoId) return null;
  const token = issueRepoShareToken(
    {
      repoId,
      shareSessionId: shareSessionId(input.shareId, input.pv),
      ...(input.origin ? { origin: input.origin } : {}),
    },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  const query = new URLSearchParams({ token });
  if (input.v) query.set("v", input.v);
  return `${previewOrigin()}/r/${repoId}/?${query.toString()}`;
}

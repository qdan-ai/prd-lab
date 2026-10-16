import { issueRepoToken, PREVIEW_HANDOFF_TTL_SECONDS } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { requestOrigin } from "@/lib/api/request-origin";
import { previewOrigin, requireReadableRepo } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST /api/v1/repos/:pid/preview-token
 * 主站「打开查看器」：签 300s 仓库级交接令牌（可读即可），返回预览站入口地址。
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;
  const repo = await requireReadableRepo(pid, session);
  if (repo instanceof Response) return repo;

  const token = issueRepoToken(
    { repoId: repo.id, sessionUserId: session.userId, origin: requestOrigin(request) },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  return Response.json({
    token,
    expiresIn: PREVIEW_HANDOFF_TTL_SECONDS,
    url: `${previewOrigin()}/r/${repo.id}?token=${token}`,
  });
}

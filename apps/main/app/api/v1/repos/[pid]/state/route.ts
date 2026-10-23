import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { getRepoPushState } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { requestOrigin } from "@/lib/api/request-origin";
import { requireManagedRepo, shareUrl } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * GET /api/v1/repos/:pid/state
 * 远端现状：全部版本（含已撤回，带 withdrawn）、草稿、起点、上线标记、最近推送、分享链接。
 * G-canvas 据此算「这次会推什么」。
 */
export async function GET(request: Request, { params }: Ctx) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;
  const repo = await requireManagedRepo(pid, session);
  if (repo instanceof Response) return repo;

  const state = await getRepoPushState(repo);
  return Response.json({
    ...state,
    // Nested share configuration follows the same creator-only rule as GET /share.
    share: repo.ownerId === session.userId && state.share
      ? {
          shareId: state.share.shareId,
          url: shareUrl(requestOrigin(request), state.share.shareId),
          hasPassword: state.share.hasPassword,
        }
      : null,
  });
}

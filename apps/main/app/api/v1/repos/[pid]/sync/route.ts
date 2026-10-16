import { getRepoShare, parseSyncManifest, syncRepo } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { requestOrigin } from "@/lib/api/request-origin";
import { repoErrorResponse, requireManagedRepo, shareUrl } from "@/lib/repo/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST /api/v1/repos/:pid/sync   清单 gcanvas-repo/1
 * 一次事务落版本清单：新版本建快照、已有版本改元数据、按 withdraw 撤回、草稿替换或撤下、上线标记。
 * 引用了未上传的文件 → 409 blobs_missing（补传后原清单重发即可）。
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;
  const repo = await requireManagedRepo(pid, session);
  if (repo instanceof Response) return repo;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const parsed = parseSyncManifest(body);
  if (!parsed.ok) return errorResponse(parsed.error.code, parsed.error.message, parsed.error.details);

  try {
    const result = await syncRepo(repo, session.userId, parsed.manifest);
    const share = await getRepoShare(repo.versionId);
    return Response.json({
      ok: true,
      ...result,
      shareUrl: share ? shareUrl(requestOrigin(request), share.shareId) : null,
    });
  } catch (e) {
    return repoErrorResponse(e);
  }
}

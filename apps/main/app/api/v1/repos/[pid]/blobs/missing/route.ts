import { findMissingBlobs } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { repoErrorResponse, requireManagedRepo } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST /api/v1/repos/:pid/blobs/missing  { sha256: string[], requireGitOid?: boolean }
 * → { missing: string[] }：本项目里还没上传过的文件指纹（只查本项目，不跨项目）。
 * requireGitOid: true 时，已上传但还没有 git 对象号的也算缺（团队流程用，重传一次即补上对象号）。
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
  const { sha256: list, requireGitOid } = (body ?? {}) as { sha256?: unknown; requireGitOid?: unknown };
  if (!Array.isArray(list)) return errorResponse("validation_error", "sha256 must be an array");
  if (requireGitOid !== undefined && typeof requireGitOid !== "boolean") {
    return errorResponse("validation_error", "requireGitOid must be a boolean");
  }

  try {
    return Response.json({ missing: await findMissingBlobs(repo.id, list as string[], { requireGitOid: requireGitOid === true }) });
  } catch (e) {
    return repoErrorResponse(e);
  }
}

import { findMissingBlobs } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { repoErrorResponse, requireManagedRepo } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST /api/v1/repos/:pid/blobs/missing  { sha256: string[] }
 * → { missing: string[] }：本项目里还没上传过的文件指纹（只查本项目，不跨项目）。
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
  const list = (body as { sha256?: unknown } | null)?.sha256;
  if (!Array.isArray(list)) return errorResponse("validation_error", "sha256 must be an array");

  try {
    return Response.json({ missing: await findMissingBlobs(repo.id, list as string[]) });
  } catch (e) {
    return repoErrorResponse(e);
  }
}

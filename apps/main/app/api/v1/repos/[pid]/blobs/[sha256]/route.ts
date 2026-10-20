import { putBlob, REPO_LIMITS } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { repoErrorResponse, requireManagedRepo } from "@/lib/repo/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string; sha256: string }> };

/**
 * PUT /api/v1/repos/:pid/blobs/:sha256   请求体 = 文件原始字节
 * 校验大小（≤ 20 MB）与指纹一致后存入本项目，并记下 git 对象号；已存在直接 200（还没有对象号的这次补上）。
 * → { sha256, existed, sizeBytes, gitOid }
 */
export async function PUT(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid, sha256 } = await params;
  const repo = await requireManagedRepo(pid, session);
  if (repo instanceof Response) return repo;

  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > REPO_LIMITS.maxFileBytes) {
    return errorResponse("validation_error", "file_too_large", {
      size: declared,
      max: REPO_LIMITS.maxFileBytes,
    });
  }

  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    const result = await putBlob(repo.id, sha256, bytes);
    return Response.json({ sha256, ...result });
  } catch (e) {
    return repoErrorResponse(e);
  }
}

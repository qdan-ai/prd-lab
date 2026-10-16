import { generateShareId, hashPassword, db, shareLinks } from "@prd-lab/core";
import { getRepoShare } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";
import { requestOrigin } from "@/lib/api/request-origin";
import { requireManagedRepo, shareUrl } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * GET /api/v1/repos/:pid/share → { share: { shareId, url, hasPassword } | null }
 * 仓库项目的项目级分享链接（挂在系统方案上，一仓库一条）。
 */
export async function GET(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;
  const repo = await requireManagedRepo(pid, session);
  if (repo instanceof Response) return repo;

  const share = await getRepoShare(repo.versionId);
  return Response.json({ share: share ? shareView(request, share) : null });
}

/**
 * POST /api/v1/repos/:pid/share  { password? }
 * 建项目级分享链接；已有 → 409 share_already_exists。密码规则同方案级分享（可选，6..200）。
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
  const password = (body as { password?: unknown } | null)?.password;
  if (password !== undefined && password !== null && password !== "") {
    if (typeof password !== "string") return errorResponse("validation_error", "password must be string");
    if (password.length < 6 || password.length > 200) {
      return errorResponse("validation_error", "password length must be 6..200");
    }
  }
  const passwordHash = typeof password === "string" && password ? await hashPassword(password) : null;

  try {
    await db.insert(shareLinks).values({
      id: generateShareId(),
      versionId: repo.versionId,
      passwordHash,
      passwordVersion: 1,
      createdBy: session.userId,
    });
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) return errorResponse("share_already_exists");
    throw e;
  }
  const share = await getRepoShare(repo.versionId);
  if (!share) return errorResponse("validation_error", "insert returned no row");
  return Response.json({ share: shareView(request, share) }, { status: 201 });
}

function shareView(request: Request, share: { shareId: string; hasPassword: boolean; createdAt: Date }) {
  return {
    shareId: share.shareId,
    url: shareUrl(requestOrigin(request), share.shareId),
    hasPassword: share.hasPassword,
    createdAt: share.createdAt,
  };
}

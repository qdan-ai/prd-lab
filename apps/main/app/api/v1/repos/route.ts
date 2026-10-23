import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { createRepoProject, listRepoProjects } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { canEditProject } from "@/lib/api/owner-check";
import { errorResponse } from "@/lib/api/errors";
import { isPgError, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from "@/lib/api/pg-errors";
import { requestOrigin } from "@/lib/api/request-origin";
import { shareUrl } from "@/lib/repo/route-helpers";

/**
 * GET /api/v1/repos
 * 当前用户能推送的仓库项目（G-canvas 首次推送「选择已有仓库」用）。
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");

  const origin = requestOrigin(request);
  const rows = await listRepoProjects();
  return Response.json(
    rows
      .filter((r) => canEditProject(r, session))
      .map((r) => ({
        id: r.id,
        name: r.name,
        visibility: r.visibility,
        lastPushedAt: r.lastPushedAt,
        shareUrl: r.shareId ? shareUrl(origin, r.shareId) : null,
      })),
  );
}

/**
 * POST /api/v1/repos  { name, visibility? }
 * 建仓库项目（项目 + 系统方案 + 仓库状态，一个事务）。
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (!session) return errorResponse("unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  if (typeof body !== "object" || body === null) {
    return errorResponse("validation_error", "body must be JSON object");
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 128) return errorResponse("validation_error", "invalid name");
  const visibility = b.visibility === "team" ? "team" : "private";

  try {
    const repo = await createRepoProject({ name, ownerId: session.userId, visibility });
    return Response.json(
      { project: { id: repo.id, name: repo.name, visibility: repo.visibility, kind: "repo" } },
      { status: 201 },
    );
  } catch (e) {
    if (isPgError(e, PG_UNIQUE_VIOLATION)) {
      return errorResponse("name_conflict", "project name already exists");
    }
    if (isPgError(e, PG_FOREIGN_KEY_VIOLATION)) {
      return errorResponse("unauthorized", "登入态失效，请重新登入");
    }
    throw e;
  }
}

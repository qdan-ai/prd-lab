import { buildRepoAgentPrompt } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { requestOrigin } from "@/lib/api/request-origin";
import { requireManagedRepo } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string }> };

/**
 * GET /api/v1/repos/:pid/agent-prompt?k=<版本 key>
 * 「复制给 AI」的提示词（G-canvas 取用）：不带密码的一段 + 带 {{PASSWORD}} 占位的一段，
 * 另给访客链接号、有无密码、密码版本号（本机记下的密码据此判断是否过期）。不返回、也不存任何明文密码。
 * `k` 缺省 = 不锁版本。按「能管理这个项目」判断；没有访客链接 → 404 share_not_found。
 */
export async function GET(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { pid } = await params;
  const repo = await requireManagedRepo(pid, session, { teamMin: "admin" });
  if (repo instanceof Response) return repo;

  const result = await buildRepoAgentPrompt(repo, requestOrigin(request), new URL(request.url).searchParams.get("k"));
  switch (result.status) {
    case "no_share":
      return errorResponse("share_not_found", "项目还没有访客链接");
    case "version_not_found":
      return errorResponse("not_found", "没有这个版本");
    case "version_withdrawn":
      return errorResponse("version_withdrawn", "这个版本已被撤回", { replacement: result.replacement });
    case "ok": {
      const { status: _status, ...body } = result;
      return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
    }
  }
}

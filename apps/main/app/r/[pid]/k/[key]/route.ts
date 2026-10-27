import { errorResponse } from "@/lib/api/errors";
import { AuthenticationUnavailableError } from "@/lib/auth/errors";
import { canReadProject, issueRepoToken, PREVIEW_HANDOFF_TTL_SECONDS } from "@prd-lab/core";
import { findProjectForRepo, getRepoShare, isValidKey } from "@prd-lab/core/repo";
import { getSession } from "@/lib/api/auth-guard";
import { requestOrigin } from "@/lib/api/request-origin";
import { previewOrigin } from "@/lib/repo/route-helpers";

type Ctx = { params: Promise<{ pid: string; key: string }> };

/**
 * GET /r/:pid/k/:key   锁版本链接（写进已封 spec 的「PRD-Lab 本版链接」，按版本 key，永不改写）
 *
 * 链接里不放访客链接号：访客链接会被主人重建，这里每次现找仓库当前的那一条。
 *   - 仓库有访客链接 → 302 /share/<链接号>?k=<key>（密码页、内容页一路带着 k，预览站严格按 key 打开）；
 *     访客链接不受项目 private / team 影响
 *   - 没有访客链接、当前用户已登录且能看这个项目（与主站「在查看器中打开」同一口径）
 *     → 签主人预览令牌，302 预览站 /r/<pid>?k=<key>&token=…
 *   - 其余（没有访客链接且未登录或无权、项目不存在或已删除、不是仓库、key 格式不对）
 *     → 同一张「没有开放访客链接」页，不区分原因（不让人借此探测项目是否存在）
 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid, key } = await params;
  const row = isValidKey(key) ? await findProjectForRepo(pid) : null;
  const repo = row && row.kind === "repo" && row.versionId ? { ...row, versionId: row.versionId } : null;
  if (!repo) return unavailable(null);

  const share = await getRepoShare(repo.versionId);
  if (share) return redirect(`/share/${share.shareId}?${new URLSearchParams({ k: key })}`);

  let session;
  try {
    session = await getSession();
  } catch (e) {
    if (e instanceof AuthenticationUnavailableError) return errorResponse("authentication_unavailable");
    throw e;
  }
  if (session && await canReadProject(pid, session.userId)) {
    const token = issueRepoToken(
      { repoId: repo.id, sessionUserId: session.userId, origin: requestOrigin(request) },
      PREVIEW_HANDOFF_TTL_SECONDS,
    );
    return redirect(`${previewOrigin()}/r/${repo.id}?${new URLSearchParams({ k: key, token })}`);
  }
  return unavailable(session ? null : `/r/${encodeURIComponent(pid)}/k/${encodeURIComponent(key)}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

/** @param loginBack 未登录时给项目成员的登录入口，登录后回到这条链接 */
function unavailable(loginBack: string | null): Response {
  const login = loginBack
    ? `<p class="sub">项目成员请先<a href="/login?callbackUrl=${encodeURIComponent(loginBack)}">登录</a>后再打开。</p>`
    : "";
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>无法打开 · PRD-Lab</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:80px 20px;color:#444;background:#fafafa}
h1{font-size:18px;color:#222;margin:0 0 8px}p{font-size:14px;margin:0 0 6px}.sub{color:#666}a{color:#2563eb}</style>
</head><body><h1>无法打开</h1><p>这个项目没有开放访客链接，或项目已被删除。请联系项目方。</p>${login}</body></html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

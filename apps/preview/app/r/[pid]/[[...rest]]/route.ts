import { NextRequest } from "next/server";
import {
  getObjectStream,
  reissueRepoToken,
  verifyRepoToken,
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  PREVIEW_SESSION_TTL_SECONDS,
  type RepoTokenPayload,
} from "@prd-lab/core";
import {
  buildRepoAgentPrompt,
  findSnapshotFile,
  getRepoShare,
  getRepoView,
  listSnapshotFiles,
  loadRepoProject,
  lookupRepoKey,
  resolveRepoVersion,
  RepoError,
  type RepoProject,
} from "@prd-lab/core/repo";
import { currentViewerBundle } from "../../../../lib/gcanvas-viewer";
import { buildRendererCsp } from "../../../../lib/renderer-csp";
import { badFilePath } from "./file-path";
import { expiredHtml, renderRepoShell } from "./shell";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string; rest?: string[] }> };

/**
 * GET /r/:pid/…  仓库项目的只读数据（G-canvas 只读查看器的 RepoReader HTTP 实现）
 *
 *   /r/:pid/                 查看器外壳（?v= / ?k= 解析结果与项目访客链接注入页面）
 *   /r/:pid/repo.json        getRepo()：未撤回的版本图、上线标记、默认版本（带 ?v= 或 ?k= 时附 resolved）
 *   /r/:pid/files/:key       listFiles(key)
 *   /r/:pid/v/:key/<路径>    readText / fileUrl：某版本某文件原文
 *   /r/:pid/agent-prompt     「复制给 AI」的提示词（?k=<key> 锁版本；没有访客链接 404）
 *
 * `?k=<key>` 是锁版本链接（主站 /r/<pid>/k/<key> 转来）：严格按 key，已撤回或不存在时不回落（resolveRepoVersion）。
 *
 * 鉴权与 /p/:snapshotId 同一机制，作用对象换成整个仓库：
 *   ?token=<300s 交接仓库令牌> → 重签 12h 会话令牌写 cookie（Path=/r/:pid，Max-Age 30d）；
 *   之后凭 cookie；会话过期时 document 导航 302 回主站重签，其余请求 401。
 * 每个请求再校验 key 属于本仓库：已撤回 → 410，不存在 → 404。两种 404 用响应头
 * `X-Repo-Error: version_not_found | file_not_found` 区分（查看器把后者当「没有这个文件」）。
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { pid, rest = [] } = await params;
  const cookieName = `prd-repo-${pid}`;
  const tokenInQuery = request.nextUrl.searchParams.get("token");
  const token = tokenInQuery ?? request.cookies.get(cookieName)?.value ?? null;
  const isDocumentNav =
    request.headers.get("sec-fetch-dest") === "document" ||
    (request.headers.get("accept") ?? "").includes("text/html");

  if (!token) return isDocumentNav ? expiredHtml() : text(401, "missing token");
  const verified = verifyRepoToken(token, pid);
  if (!verified.valid) {
    if (verified.expired) {
      if (isDocumentNav) {
        const refreshUrl = buildRefreshUrl(verified.payload, pid, request);
        if (!refreshUrl) return expiredHtml();
        return new Response(null, { status: 302, headers: { Location: refreshUrl } });
      }
      return new Response("token expired", {
        status: 401,
        headers: { "X-Token-Expired": "1", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return isDocumentNav ? expiredHtml() : text(401, `token invalid: ${verified.reason}`);
  }

  let repo: RepoProject;
  try {
    repo = await loadRepoProject(pid);
  } catch (e) {
    if (e instanceof RepoError) return text(404, "repo not found");
    throw e;
  }

  const response = await dispatch(repo, rest, request, verified.payload.origin ?? null);
  if (tokenInQuery) {
    response.headers.append(
      "Set-Cookie",
      `${cookieName}=${reissueRepoToken(verified.payload, PREVIEW_SESSION_TTL_SECONDS)}` +
        `; Path=/r/${pid}; HttpOnly; SameSite=Lax; Max-Age=${PREVIEW_COOKIE_MAX_AGE_SECONDS}`,
    );
  }
  return response;
}

/**
 * @param mainOrigin 主站 origin，取自会话令牌里受签名保护的 claim；拼项目访客链接用，没有时不给链接
 */
async function dispatch(
  repo: RepoProject,
  rest: string[],
  request: NextRequest,
  mainOrigin: string | null,
): Promise<Response> {
  const v = request.nextUrl.searchParams.get("v");
  const k = request.nextUrl.searchParams.get("k");

  if (rest.length === 0) {
    const [{ view, resolveInput }, share] = await Promise.all([getRepoView(repo), getRepoShare(repo.versionId)]);
    const resolved = resolveRepoVersion(resolveInput, v, k);
    const html = renderRepoShell({
      projectName: repo.name,
      versions: view.versions.map((x) => ({ key: x.key, number: x.number, name: x.name })),
      hasDraft: view.draft !== null,
      viewer: currentViewerBundle(),
      config: {
        apiBase: `/r/${repo.id}`,
        repoJson: `/r/${repo.id}/repo.json`,
        initialVersion: resolved.key,
        notice: resolved.notice,
        versionParam: "v",
        shareUrl: share && mainOrigin ? `${mainOrigin}/share/${share.shareId}` : null,
      },
    });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": buildRendererCsp({ httpsImages: true }),
      },
    });
  }

  if (rest.length === 1 && rest[0] === "repo.json") {
    const { view, resolveInput } = await getRepoView(repo);
    return json(
      200,
      v === null && k === null ? view : { ...view, resolved: resolveRepoVersion(resolveInput, v, k) },
    );
  }

  if (rest.length === 2 && rest[0] === "files") {
    const found = await lookupRepoKey(repo.id, rest[1]!);
    if (found.status !== "ok") return keyError(found.status);
    return json(200, { key: rest[1], files: await listSnapshotFiles(found.snapshotId) }, "private, no-cache");
  }

  if (rest.length === 1 && rest[0] === "agent-prompt") {
    // 提示词里的主站地址只取自会话令牌里受签名保护的 claim；没有就无从拼出接口地址
    if (!mainOrigin) return json(404, { error: "no_share", message: "没有可用的访客链接" });
    const result = await buildRepoAgentPrompt(repo, mainOrigin, k);
    switch (result.status) {
      case "no_share":
        return json(404, { error: "no_share", message: "项目还没有访客链接" });
      case "version_not_found":
        return keyError("not_found");
      case "version_withdrawn":
        return json(410, { error: "withdrawn", message: "该版本已被撤回", replacement: result.replacement });
      case "ok":
        return json(200, { hasPassword: result.hasPassword, version: result.version, prompt: result.prompt });
    }
  }

  if (rest.length >= 3 && rest[0] === "v") {
    const relPath = rest.slice(2).join("/");
    if (badFilePath(relPath)) return text(400, "invalid path");
    const found = await lookupRepoKey(repo.id, rest[1]!);
    if (found.status !== "ok") return keyError(found.status);
    const file = await findSnapshotFile(found.snapshotId, relPath);
    if (!file) return text(404, "file not found", { "X-Repo-Error": "file_not_found" });
    return streamObject(file.s3Key, file.contentType);
  }

  return text(404, "not found");
}

async function streamObject(s3Key: string, contentType: string): Promise<Response> {
  const obj = await getObjectStream(s3Key);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webStream = (obj.stream as any).toWeb
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((obj.stream as any).toWeb() as ReadableStream)
    : new ReadableStream({
        async start(controller) {
          for await (const chunk of obj.stream) controller.enqueue(chunk);
          controller.close();
        },
      });
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    // 版本内容按 key 不可变；HTML 不缓存，与 /p/ 一致
    "Cache-Control": contentType.startsWith("text/html")
      ? "private, no-store"
      : "private, max-age=31536000, immutable",
  };
  if (typeof obj.contentLength === "number") headers["Content-Length"] = String(obj.contentLength);
  return new Response(webStream, { status: 200, headers });
}

function keyError(status: "withdrawn" | "not_found"): Response {
  return status === "withdrawn"
    ? json(410, { error: "withdrawn", message: "该版本已被撤回" })
    : json(404, { error: "not_found", message: "版本不存在" }, "no-store", { "X-Repo-Error": "version_not_found" });
}

function json(status: number, body: unknown, cacheControl = "no-store", extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": cacheControl, ...extra } });
}

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extra } });
}

/**
 * 由过期令牌的 payload 拼主站重签端点；origin 来自 HMAC 签名保护的 claim，不取请求参数。
 * 访客 → /share/<链接号>/preview-refresh?rid=；主人 → /api/v1/repos/<pid>/preview-refresh。
 */
function buildRefreshUrl(payload: RepoTokenPayload, pid: string, request: NextRequest): string | null {
  if (!payload.origin) return null;
  const params = new URLSearchParams(request.nextUrl.search);
  params.delete("token");
  const rest = params.toString();
  const next = encodeURIComponent(request.nextUrl.pathname + (rest ? `?${rest}` : ""));
  if (payload.kind === "share") {
    const sep = payload.sub.lastIndexOf(":");
    if (sep <= 0) return null;
    return `${payload.origin}/share/${payload.sub.slice(0, sep)}/preview-refresh?rid=${pid}&next=${next}`;
  }
  return `${payload.origin}/api/v1/repos/${pid}/preview-refresh?next=${next}`;
}

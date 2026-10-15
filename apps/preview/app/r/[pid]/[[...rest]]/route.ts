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
  findSnapshotFile,
  getRepoView,
  listSnapshotFiles,
  loadRepoProject,
  lookupRepoKey,
  resolveRepoVersion,
  RepoError,
  type RepoProject,
} from "@prd-lab/core/repo";
import { buildRendererCsp } from "../../../../lib/renderer-csp";
import { expiredHtml, renderRepoShell } from "./shell";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ pid: string; rest?: string[] }> };

/**
 * GET /r/:pid/…  仓库项目的只读数据（G-canvas 只读查看器的 RepoReader HTTP 实现）
 *
 *   /r/:pid/                 查看器外壳（?v= 解析结果注入页面）
 *   /r/:pid/repo.json        getRepo()：未撤回的版本图、上线标记、默认版本（带 ?v= 时附 resolved）
 *   /r/:pid/files/:key       listFiles(key)
 *   /r/:pid/v/:key/<路径>    readText / fileUrl：某版本某文件原文
 *
 * 鉴权与 /p/:snapshotId 同一机制，作用对象换成整个仓库：
 *   ?token=<300s 交接仓库令牌> → 重签 12h 会话令牌写 cookie（Path=/r/:pid，Max-Age 30d）；
 *   之后凭 cookie；会话过期时 document 导航 302 回主站重签，其余请求 401。
 * 每个请求再校验 key 属于本仓库：已撤回 → 410，不存在 → 404。
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

  const response = await dispatch(repo, rest, request);
  if (tokenInQuery) {
    response.headers.append(
      "Set-Cookie",
      `${cookieName}=${reissueRepoToken(verified.payload, PREVIEW_SESSION_TTL_SECONDS)}` +
        `; Path=/r/${pid}; HttpOnly; SameSite=Lax; Max-Age=${PREVIEW_COOKIE_MAX_AGE_SECONDS}`,
    );
  }
  return response;
}

async function dispatch(repo: RepoProject, rest: string[], request: NextRequest): Promise<Response> {
  const v = request.nextUrl.searchParams.get("v");

  if (rest.length === 0) {
    const { view, resolveInput } = await getRepoView(repo);
    const resolved = resolveRepoVersion(resolveInput, v);
    const html = renderRepoShell({
      projectName: repo.name,
      versions: view.versions.map((x) => ({ key: x.key, number: x.number, name: x.name })),
      hasDraft: view.draft !== null,
      config: {
        apiBase: `/r/${repo.id}`,
        repoJson: `/r/${repo.id}/repo.json`,
        initialVersion: resolved.key,
        notice: resolved.notice,
        versionParam: "v",
      },
    });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": buildRendererCsp(),
      },
    });
  }

  if (rest.length === 1 && rest[0] === "repo.json") {
    const { view, resolveInput } = await getRepoView(repo);
    return json(200, v === null ? view : { ...view, resolved: resolveRepoVersion(resolveInput, v) });
  }

  if (rest.length === 2 && rest[0] === "files") {
    const found = await lookupRepoKey(repo.id, rest[1]!);
    if (found.status !== "ok") return keyError(found.status);
    return json(200, { key: rest[1], files: await listSnapshotFiles(found.snapshotId) }, "private, no-cache");
  }

  if (rest.length >= 3 && rest[0] === "v") {
    const relPath = rest.slice(2).join("/");
    if (
      relPath.length > 1024 ||
      relPath.includes("..") ||
      relPath.includes("\\") ||
      // eslint-disable-next-line no-control-regex
      /[\x00-\x1f]/.test(relPath)
    ) {
      return text(400, "invalid path");
    }
    const found = await lookupRepoKey(repo.id, rest[1]!);
    if (found.status !== "ok") return keyError(found.status);
    const file = await findSnapshotFile(found.snapshotId, relPath);
    if (!file) return text(404, "file not found");
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
    : json(404, { error: "not_found", message: "版本不存在" });
}

function json(status: number, body: unknown, cacheControl = "no-store"): Response {
  return Response.json(body, { status, headers: { "Cache-Control": cacheControl } });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
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

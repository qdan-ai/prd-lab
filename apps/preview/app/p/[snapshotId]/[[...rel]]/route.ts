import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  getObjectStream,
  reissueToken,
  snapshotFiles,
  snapshotInAudience,
  snapshots,
  verifyToken,
  versions,
  projects,
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  PREVIEW_SESSION_TTL_SECONDS,
  type TokenPayload,
} from "@prd-lab/core";
import { RENDERERS } from "@prd-lab/core/renderers";
import { renderLoadingShell } from "./shell";
import { renderRendererSpaShell } from "./renderer-shell";
import { buildRendererCsp } from "../../../../lib/renderer-csp";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ snapshotId: string; rel?: string[] }> };

/**
 * GET /p/:snapshotId/:rel*
 *
 * S9 简化：所有 rel（含入口 HTML）一律 S3 透传，无 SDK 注入。
 * S9 Hotfix R2：tokenInQuery 分支返回 loading shell HTML（带 PM 搬砖小人进度动画），
 * 而非 302。子资源仍走 cookie；天然只有入口请求会带 query token。
 *
 * 鉴权（S20 三层时长解耦）：
 *   - 首次 ?token=<HMAC 300s 交接> → 校 token → **重签 12h 会话 token** 写 cookie
 *     （Path=/p/{sid}，Max-Age 30d 故意长于 token），返回 shell HTML
 *     → shell 内 JS fetch 同源 cleanPath（cookie 已 Set 会带）+ ReadableStream 进度
 *     → 完成后 document.open/write 替换文档
 *   - 后续子资源 → 校 cookie → S3 透传（HTML 响应附 Content-Length）
 *   - 会话 token 过期后 cookie 仍在：document 导航按 payload.origin + kind 302 回主站/
 *     分享页的 preview-refresh 端点自动重签弹回；子资源保持原 plain text 401
 *     （避免给 fetch/img 返 HTML）
 *
 * archived snapshot → HTTP 410 Gone
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { snapshotId, rel } = await params;
  const cookieName = `prd-preview-${snapshotId}`;
  const tokenInQuery = request.nextUrl.searchParams.get("token");
  const tokenInCookie = request.cookies.get(cookieName)?.value ?? null;
  const token = tokenInQuery ?? tokenInCookie;

  // S20：document 导航（用户在 demo 内点链接跳页）才做自动重签 / 友好页；
  // 子资源（css/js/img/fetch）保持原 plain text 契约。
  const isDocumentNav = isDocumentNavigation(request);

  if (!token) {
    if (isDocumentNav) return expiredHtml();
    return text(401, "missing token");
  }
  const verifyResult = verifyToken(token, snapshotId);
  if (!verifyResult.valid) {
    if (verifyResult.expired) {
      if (isDocumentNav) {
        const refreshUrl = buildRefreshUrl(verifyResult.payload, snapshotId, request);
        // 无 origin（老 token）或 share sub 解不出 shareId → 无法自动重签，走友好页
        if (!refreshUrl) return expiredHtml();
        return new Response(null, { status: 302, headers: { Location: refreshUrl } });
      }
      return new Response("token expired", {
        status: 401,
        headers: { "X-Token-Expired": "1", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (isDocumentNav) return expiredHtml();
    return text(401, `token invalid: ${verifyResult.reason}`);
  }

  // 会话 cookie：把 300s 交接 token 重签成 12h 会话 token；Max-Age 30d 远长于 token，
  // 让过期后仍有 payload 可用于自动重签。仅 tokenInQuery 分支需要，故惰性求值。
  const buildSessionCookie = () =>
    `${cookieName}=${reissueToken(verifyResult.payload, PREVIEW_SESSION_TTL_SECONDS)}` +
    `; Path=/p/${snapshotId}; HttpOnly; SameSite=Lax; Max-Age=${PREVIEW_COOKIE_MAX_AGE_SECONDS}`;

  const snapRows = await db
    .select({
      id: snapshots.id,
      entryHtmlPath: snapshots.entryHtmlPath,
      archivedAt: snapshots.archivedAt,
      rendererName: snapshots.rendererName,
      rendererMetadata: snapshots.rendererMetadata,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(snapshots.id, snapshotId),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
        snapshotInAudience("guest"),
      ),
    )
    .limit(1);
  const snap = snapRows[0];
  if (!snap) return text(404, "snapshot not found");
  if (snap.archivedAt !== null) return goneHtml();

  // ── renderer SPA 分支（DESIGN §6.1 / 决策 D6）──
  // 命中条件：rendererName != null && tokenInQuery && (rel 为空 || rel===entryHtmlPath) && 非 raw=1
  // raw=1 不是鉴权机制，只是"取画板原文，别给我 SPA"的元信号；缺失时按 SPA 走
  const usesCustomRenderer = snap.rendererName !== null && snap.rendererName !== "default";
  const isRawRequest = request.nextUrl.searchParams.get("raw") === "1";
  const isEntryHtmlRequest =
    !rel || rel.length === 0 || rel.join("/") === snap.entryHtmlPath;

  if (usesCustomRenderer && tokenInQuery && isEntryHtmlRequest && !isRawRequest) {
    const spec = RENDERERS[snap.rendererName!];
    if (!spec) {
      return text(500, `renderer ${snap.rendererName} not registered`);
    }
    let spaHtml: string;
    try {
      spaHtml = await renderRendererSpaShell({
        spec,
        snapshotId,
        entryHtmlPath: snap.entryHtmlPath,
        rendererMetadata: snap.rendererMetadata,
      });
    } catch (e) {
      console.error("[preview] renderer-shell render failed:", e);
      return text(500, `renderer ${spec.name} asset missing or invalid`);
    }

    return new Response(spaHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": buildRendererCsp(),
        "Set-Cookie": buildSessionCookie(),
      },
    });
  }

  if (tokenInQuery) {
    const cleanPath = request.nextUrl.pathname;

    // R3 P0：仅 HTML 文件返回 shell（带 PM 搬砖小人进度动画）；
    // 非 HTML（图片/css/js/其他）走原 302 路径让浏览器原生加载。
    // 判 contentType 需查 snapshotFiles：rel 为空（入口）→ 用 snap.entryHtmlPath；否则 rel.join("/")
    const probeRel = !rel || rel.length === 0 ? snap.entryHtmlPath : rel.join("/");
    const probe = await db
      .select({ contentType: snapshotFiles.contentType })
      .from(snapshotFiles)
      .where(and(eq(snapshotFiles.snapshotId, snap.id), eq(snapshotFiles.relPath, probeRel)))
      .limit(1);
    const isHtmlFile = probe[0]?.contentType?.startsWith("text/html") ?? false;

    if (isHtmlFile) {
      const shellHtml = renderLoadingShell(cleanPath);
      return new Response(shellHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": buildSessionCookie(),
        },
      });
    }

    // 非 HTML：原 302 + Set-Cookie 路径（浏览器原生加载）
    return new Response(null, {
      status: 302,
      headers: { Location: cleanPath, "Set-Cookie": buildSessionCookie() },
    });
  }

  const isEntry = !rel || rel.length === 0;
  const relPath = isEntry ? snap.entryHtmlPath : rel.join("/");
  // 黑名单校验：允许 UTF-8（含中文/空格），但拒 zip slip + 控制字符
  if (
    relPath.length === 0 ||
    relPath.length > 1024 ||
    relPath.includes("..") ||
    relPath.includes("\\") ||
    relPath.startsWith("/") ||
    /[\x00-\x1f]/.test(relPath)
  ) {
    return text(400, "invalid rel path");
  }
  return serveChild(snap.id, relPath);
}

async function serveChild(snapshotId: string, relPath: string): Promise<Response> {
  const fileRows = await db
    .select({ s3Key: snapshotFiles.s3Key, contentType: snapshotFiles.contentType })
    .from(snapshotFiles)
    .where(and(eq(snapshotFiles.snapshotId, snapshotId), eq(snapshotFiles.relPath, relPath)))
    .limit(1);
  const fileRow = fileRows[0];
  if (!fileRow) return text(404, "file not found");

  const obj = await getObjectStream(fileRow.s3Key);
  // @ts-expect-error toWeb 在 Node 18+ 可用
  const webStream = obj.stream.toWeb
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((obj.stream as any).toWeb() as ReadableStream)
    : new ReadableStream({
        async start(controller) {
          for await (const chunk of obj.stream) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

  const isHtml = fileRow.contentType.startsWith("text/html");
  const headers: Record<string, string> = {
    "Content-Type": fileRow.contentType,
    "Cache-Control": isHtml ? "private, no-store" : "public, max-age=31536000, immutable",
  };
  // 让 shell 的 fetch 拿到 content-length 做进度分母
  if (typeof obj.contentLength === "number") {
    headers["Content-Length"] = String(obj.contentLength);
  }
  return new Response(webStream, { status: 200, headers });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * S20：判定是否 document 导航（整页跳转）。
 * `Sec-Fetch-Dest: document` 是现代浏览器的权威信号；老浏览器 / 无该头时用
 * `Accept` 含 text/html 兜底。子资源（css/js/img/fetch）两者都不满足。
 */
function isDocumentNavigation(request: NextRequest): boolean {
  return (
    request.headers.get("sec-fetch-dest") === "document" ||
    (request.headers.get("accept") ?? "").includes("text/html")
  );
}

/**
 * S20：由过期 token 的 payload 拼出主站/分享页的重签端点 URL。
 * origin 来自 HMAC 签名保护的 claim（不接受请求参数），避免开放重定向。
 * 无 origin（老 token）或 share sub 解不出 shareId → 返 null，调用方走友好页。
 */
function buildRefreshUrl(
  payload: TokenPayload,
  snapshotId: string,
  request: NextRequest,
): string | null {
  if (!payload.origin) return null;

  // 回跳目标：当前路径 + 去掉 token 的原查询串
  const params = new URLSearchParams(request.nextUrl.search);
  params.delete("token");
  const rest = params.toString();
  const nextPath = request.nextUrl.pathname + (rest ? `?${rest}` : "");
  const next = encodeURIComponent(nextPath);

  if (payload.kind === "share") {
    // sub 形如 `${shareId}:${pv}`；lastIndexOf 防御 shareId 内含冒号的情形
    const sep = payload.sub.lastIndexOf(":");
    if (sep <= 0) return null;
    const shareId = payload.sub.slice(0, sep);
    return `${payload.origin}/share/${shareId}/preview-refresh?sid=${snapshotId}&next=${next}`;
  }
  return `${payload.origin}/api/v1/snapshots/${snapshotId}/preview-refresh?next=${next}`;
}

/**
 * S20：document 导航但无法自动重签（完全无 token / 过期但无 origin / 签名非法）时的
 * 友好 401 页，替代裸文本 `missing token`。
 */
function expiredHtml(): Response {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>预览链接已失效</title>
<style>body{font-family:system-ui;text-align:center;padding:80px 20px;color:#444}h1{color:#a00}</style>
</head><body><h1>预览链接已失效</h1><p>请回到主站或分享页，重新打开该文件。</p></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function goneHtml(): Response {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>该版本已被删除</title>
<style>body{font-family:system-ui;text-align:center;padding:80px 20px;color:#444}h1{color:#a00}</style>
</head><body><h1>该版本已被删除</h1><p>请联系项目所有者获取最新版本。</p></body></html>`;
  return new Response(html, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

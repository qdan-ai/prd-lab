import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  getObjectStream,
  snapshotFiles,
  snapshots,
  verifyToken,
  versions,
  projects,
} from "@prd-lab/core";
import { renderLoadingShell } from "./shell";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ snapshotId: string; rel?: string[] }> };

/**
 * GET /p/:snapshotId/:rel*
 *
 * S9 简化：所有 rel（含入口 HTML）一律 S3 透传，无 SDK 注入。
 * S9 Hotfix R2：tokenInQuery 分支返回 loading shell HTML（带 PM 搬砖小人进度动画），
 * 而非 302。子资源仍走 cookie；天然只有入口请求会带 query token。
 *
 * 鉴权：
 *   - 首次 ?token=<HMAC> → 校 token → 返回 shell HTML + Set-Cookie path=/p/{sid} Max-Age=300
 *     → shell 内 JS fetch 同源 cleanPath（cookie 已 Set 会带）+ ReadableStream 进度
 *     → 完成后 document.open/write 替换文档
 *   - 后续子资源 → 校 cookie → S3 透传（HTML 响应附 Content-Length）
 *
 * archived snapshot → HTTP 410 Gone
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { snapshotId, rel } = await params;
  const cookieName = `prd-preview-${snapshotId}`;
  const tokenInQuery = request.nextUrl.searchParams.get("token");
  const tokenInCookie = request.cookies.get(cookieName)?.value ?? null;
  const token = tokenInQuery ?? tokenInCookie;

  if (!token) return text(401, "missing token");
  const verifyResult = verifyToken(token, snapshotId);
  if (!verifyResult.valid) {
    if (verifyResult.expired) {
      return new Response("token expired", {
        status: 401,
        headers: { "X-Token-Expired": "1", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return text(401, `token invalid: ${verifyResult.reason}`);
  }

  const snapRows = await db
    .select({
      id: snapshots.id,
      entryHtmlPath: snapshots.entryHtmlPath,
      archivedAt: snapshots.archivedAt,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(eq(snapshots.id, snapshotId), isNull(versions.archivedAt), isNull(projects.archivedAt)),
    )
    .limit(1);
  const snap = snapRows[0];
  if (!snap) return text(404, "snapshot not found");
  if (snap.archivedAt !== null) return goneHtml();

  if (tokenInQuery) {
    const cleanPath = request.nextUrl.pathname;
    const setCookie = `${cookieName}=${tokenInQuery}; Path=/p/${snapshotId}; HttpOnly; SameSite=Lax; Max-Age=300`;

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
          "Set-Cookie": setCookie,
        },
      });
    }

    // 非 HTML：原 302 + Set-Cookie 路径（浏览器原生加载）
    return new Response(null, {
      status: 302,
      headers: { Location: cleanPath, "Set-Cookie": setCookie },
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

function goneHtml(): Response {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>该版本已被删除</title>
<style>body{font-family:system-ui;text-align:center;padding:80px 20px;color:#444}h1{color:#a00}</style>
</head><body><h1>该版本已被删除</h1><p>请联系项目所有者获取最新版本。</p></body></html>`;
  return new Response(html, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

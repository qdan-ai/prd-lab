import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { parseHTML } from "linkedom";
import {
  db,
  getObjectBuffer,
  snapshotFiles,
  snapshots,
  verifyToken,
  versions,
  projects,
} from "@prd-lab/core";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ snapshotId: string }> };

/**
 * GET /p/:snapshotId/__entry?token=...
 * preview iframe 入口。verify token → 拉 entry HTML → 注入 base/CSP/SDK 占位 → 返 HTML。
 * archived → 410 Gone。
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const { snapshotId } = await params;
  const token = request.nextUrl.searchParams.get("token");

  if (!token) return forbid("missing token");
  const verifyResult = verifyToken(token, snapshotId);
  if (!verifyResult.valid) {
    if (verifyResult.expired) {
      return new Response("token expired", {
        status: 401,
        headers: { "X-Token-Expired": "1", "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return forbid(`token invalid: ${verifyResult.reason}`);
  }

  // 查 snapshot
  const rows = await db
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
  const row = rows[0];
  if (!row) return new Response("not found", { status: 404 });
  if (row.archivedAt !== null) return goneHtml();

  // 拿 entry HTML
  const fileRow = await db
    .select({ s3Key: snapshotFiles.s3Key })
    .from(snapshotFiles)
    .where(
      and(eq(snapshotFiles.snapshotId, snapshotId), eq(snapshotFiles.relPath, row.entryHtmlPath)),
    )
    .limit(1);
  const s3Key = fileRow[0]?.s3Key;
  if (!s3Key) return new Response("entry html missing", { status: 404 });

  const buffer = await getObjectBuffer(s3Key);
  const html = buffer.toString("utf8");

  // 注入 base + CSP + 占位 SDK scripts
  const injected = injectPreviewBoilerplate(html, snapshotId, token);

  const csp = [
    "default-src 'self' https://main.local http://main.local",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://main.local http://main.local",
    "style-src 'self' 'unsafe-inline' https://main.local http://main.local",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https: http:",
    "connect-src 'self' https://main.local http://main.local",
    "frame-ancestors https://app.local http://app.local http://localhost:3000",
  ].join("; ");

  return new Response(injected, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cache-Control": "private, no-store",
    },
  });
}

function injectPreviewBoilerplate(html: string, snapshotId: string, token: string): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head") ?? document.documentElement;

  // 1. <base> —— 子资源相对路径继承 token
  let base = head.querySelector("base");
  if (!base) {
    base = document.createElement("base");
    head.insertBefore(base, head.firstChild);
  }
  base.setAttribute("href", `/p/${snapshotId}/?token=${encodeURIComponent(token)}`);

  // 2. CSP meta（与 HTTP 头同步；冗余但兼容旧 chrome）
  const cspMeta = document.createElement("meta");
  cspMeta.setAttribute("http-equiv", "Content-Security-Policy");
  cspMeta.setAttribute(
    "content",
    "default-src 'self' https://main.local http://main.local; frame-ancestors https://app.local http://app.local http://localhost:3000",
  );
  head.appendChild(cspMeta);

  // 3. canvas-runtime 占位（S3 接入真实 SDK；S2 仅占位 404 也 OK）
  const runtimeScript = document.createElement("script");
  runtimeScript.setAttribute("id", "prd-canvas-runtime");
  runtimeScript.setAttribute("src", "http://main.local/sdk/canvas-runtime/v1.js");
  runtimeScript.setAttribute("data-snapshot-id", snapshotId);
  head.appendChild(runtimeScript);

  // 4. comment-sdk 占位（S4 接入）
  const commentScript = document.createElement("script");
  commentScript.setAttribute("id", "prd-comment-sdk");
  commentScript.setAttribute("src", "http://main.local/sdk/comment-sdk/v1.js");
  commentScript.setAttribute("data-snapshot-id", snapshotId);
  head.appendChild(commentScript);

  return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
}

function forbid(msg: string): Response {
  return new Response(msg, {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function goneHtml(): Response {
  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>该快照已被删除</title>
<style>body{font-family:system-ui;text-align:center;padding:80px 20px;color:#444}h1{color:#a00}</style>
</head><body><h1>该快照已被删除</h1><p>请联系项目所有者获取最新版本。</p></body></html>`;
  return new Response(html, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

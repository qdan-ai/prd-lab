import { and, eq, isNull } from "drizzle-orm";
import { canReadProject, db, users } from "@prd-lab/core";

type PreviewIdentity = { kind: "user" | "share"; sub: string; origin?: string };

/**
 * Only call with a verified, unexpired HMAC identity and current DB project metadata.
 *
 * Share identities pass: share tokens are issued only after the main site's getShareSession check, and every
 * reissue goes back through it, so revocation or a password change takes effect at the next reissue.
 * Private visibility only limits account (user) identities.
 */
export async function privatePreviewDenial(
  project: { id: string; visibility: "team" | "private" },
  identity: PreviewIdentity,
  document: boolean,
): Promise<Response | null> {
  if (project.visibility === "team" || identity.kind === "share") return null;
  // Preview credentials are independent of password changes, but never outlive the account itself.
  const [account] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, identity.sub), isNull(users.archivedAt))).limit(1);
  if (account && await canReadProject(project.id, identity.sub)) return null;
  if (!document) return new Response("not found", { status: 404 });
  // Origin is signed, never a query-string redirect destination. Escape it for the HTML attribute.
  const origin = identity.origin;
  const href = origin ? `${origin}/login?callbackUrl=${encodeURIComponent(`/projects/${project.id}`)}` : null;
  const safeHref = href?.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return new Response(`<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><title>无法访问预览</title><body><h1>无法访问预览</h1><p>请回到主站登录有访问权的账户，重新打开项目。</p>${safeHref ? `<a href="${safeHref}">返回主站登录</a>` : ""}</body></html>`, {
    status: 404, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Responses that set their own Cache-Control (immutable version files) keep it. Everything else — shells,
 * file lists, redirects, errors — is revalidated on every request.
 */
export async function protectedPreviewResponse(run: () => Promise<Response>): Promise<Response> {
  const response = await run();
  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

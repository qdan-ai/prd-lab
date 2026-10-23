import { and, eq, isNull } from "drizzle-orm";
import { canReadProject, db, users } from "@prd-lab/core";

type PreviewIdentity = { kind: "user" | "share"; sub: string; origin?: string };

/** Only call with a verified, unexpired HMAC identity and current DB project metadata. */
export async function privatePreviewDenial(
  project: { id: string; visibility: "team" | "private" },
  identity: PreviewIdentity,
  document: boolean,
): Promise<Response | null> {
  if (project.visibility === "team") return null;
  const status = identity.kind === "share" ? 401 : 404;
  if (identity.kind === "user") {
    // Preview credentials are independent of password changes, but never outlive the account itself.
    const [account] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, identity.sub), isNull(users.archivedAt))).limit(1);
    if (account && await canReadProject(project.id, identity.sub)) return null;
  }
  if (!document) return new Response(status === 401 ? "account required" : "not found", { status });
  // Origin is signed, never a query-string redirect destination. Escape it for the HTML attribute.
  const origin = identity.origin;
  const href = origin ? `${origin}/login?callbackUrl=${encodeURIComponent(`/projects/${project.id}`)}` : null;
  const safeHref = href?.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return new Response(`<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><title>无法访问预览</title><body><h1>无法访问预览</h1><p>请回到主站登录有访问权的账户，重新打开项目。</p>${safeHref ? `<a href="${safeHref}">返回主站登录</a>` : ""}</body></html>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Includes shells, redirects, errors and child resources, even while the project is team-visible. */
export async function protectedPreviewResponse(run: () => Promise<Response>): Promise<Response> {
  const response = await run();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

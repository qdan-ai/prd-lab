import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, issueShareCookie, shareLinks, verifyPassword } from "@prd-lab/core";
import { errorResponse } from "@/lib/api/errors";
import { shareCookieName } from "@/lib/share/share-session";

type Ctx = { params: Promise<{ shareId: string }> };

const COOKIE_TTL_SECONDS = 7 * 24 * 3600;

/**
 * POST /share/[shareId]/api/login
 *
 * body { password }
 *
 * S9：删 share_link_attempts 限流表（评论场景才需要的高频试错审计）；
 *      访客直接 bcrypt 校密码，失败 401。
 *      姓名/邮箱字段在评论功能移除后已无任何下游用途，一并精简。
 */
export async function POST(request: Request, { params }: Ctx) {
  const { shareId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_error", "invalid JSON");
  }
  const parsed = parseLoginBody(body);
  if (!parsed.ok) return errorResponse("validation_error", parsed.message);

  const shareRows = await db
    .select({
      id: shareLinks.id,
      passwordHash: shareLinks.passwordHash,
      passwordVersion: shareLinks.passwordVersion,
      revokedAt: shareLinks.revokedAt,
    })
    .from(shareLinks)
    .where(eq(shareLinks.id, shareId))
    .limit(1);
  const share = shareRows[0];
  if (!share) return errorResponse("share_not_found");
  if (share.revokedAt !== null) return errorResponse("share_revoked");

  const ok = await verifyPassword(parsed.password, share.passwordHash);
  if (!ok) {
    return errorResponse("validation_error", "wrong password");
  }

  const cookieValue = issueShareCookie(
    { shareId, pv: share.passwordVersion },
    COOKIE_TTL_SECONDS,
  );
  const cookieStore = await cookies();
  cookieStore.set(shareCookieName(shareId), cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(process.env.MAIN_ORIGIN ?? "http://localhost:3000").protocol === "https:",
    path: `/share/${shareId}`,
    maxAge: COOKIE_TTL_SECONDS,
  });

  return Response.json({ ok: true });
}

function parseLoginBody(body: unknown):
  | { ok: true; password: string }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.password !== "string" || !b.password) {
    return { ok: false, message: "password required" };
  }
  return { ok: true, password: b.password };
}

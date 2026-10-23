import { and, desc, eq, isNull } from "drizzle-orm";
import { apiTokens, db } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { createAccountToken } from "@/lib/auth/account-tokens";
import { accountErrorResponse } from "@/lib/auth/account-errors";

/**
 * GET /api/v1/cli/tokens —— 列当前用户活跃 token（不返 hash，仅 prefix/name/last_used）
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");

    const rows = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        scopes: apiTokens.scopes,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, session.userId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt));

    return Response.json(rows);
  } catch (error) { return accountErrorResponse(error); }
}

/**
 * POST /api/v1/cli/tokens —— 创建 token；明文仅返一次
 * body: { name: string }
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return errorResponse("unauthorized");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("validation_error", "invalid JSON");
    }

    const name = parseName(body);
    if (!name.ok) return errorResponse("validation_error", name.message);

    return Response.json(await createAccountToken(session, name.value), { status: 201 });
  } catch (error) { return accountErrorResponse(error); }
}

function parseName(body: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be JSON object" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, message: "name required" };
  if (name.length > 128) return { ok: false, message: "name too long" };
  return { ok: true, value: name };
}

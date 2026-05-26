import { and, eq, isNull } from "drizzle-orm";
import { apiTokens, db } from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

/**
 * DELETE /api/v1/cli/tokens/[id] —— 撤销 token（软删，写 revoked_at）。
 * 跨用户隔离：仅能撤销自己的 token；他人 token 返 404（不暴露存在性）。
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");

  const { id } = await ctx.params;
  if (!id) return errorResponse("validation_error", "id required");

  // 先验存在 + 未撤销，再 UPDATE。竞态窗口极小（同一 token 并发撤销概率近零）
  const existing = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.userId, session.userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .limit(1);
  if (existing.length === 0) return errorResponse("not_found", "token not found or already revoked");

  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, session.userId)));

  return Response.json({ ok: true, id });
}

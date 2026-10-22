import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { repoState } from "../db/schema";
import { TeamError } from "./team-errors";

type Conn = Pick<typeof db, "select" | "update">;

/** 请求头 `X-Gcanvas-Team-Format` 的值：正整数。 */
export function parseTeamFormat(value: string | null): { ok: true; format: number } | { ok: false; reason: string } {
  if (value === null || value.trim() === "") return { ok: false, reason: "missing_team_format" };
  if (!/^[1-9][0-9]{0,8}$/.test(value.trim())) return { ok: false, reason: "invalid_team_format" };
  return { ok: true, format: Number(value.trim()) };
}

/** 这个团队写入过的最高团队格式版本，随团队状态返回为 `minClientFormat`（至少为 1）。 */
export function minClientFormatOf(teamClientFormat: number): number {
  return Math.max(1, teamClientFormat);
}

/** 客户端的格式版本低于团队要求 → `client_too_old`，什么都不写。 */
export async function assertClientFormat(projectId: string, format: number, conn: Conn = db): Promise<void> {
  const rows = await conn
    .select({ teamClientFormat: repoState.teamClientFormat })
    .from(repoState)
    .where(eq(repoState.projectId, projectId))
    .limit(1);
  const min = rows[0]?.teamClientFormat ?? 0;
  if (format < min) {
    throw new TeamError("client_too_old", "这个团队里有人用了更新的 G-canvas，先升级再继续", {
      minClientFormat: min,
      clientFormat: format,
    });
  }
}

/** 带内容的写入成功时调用（与写入同一事务）：把请求头的版本并入「已见过的最高值」。 */
export async function noteClientFormat(projectId: string, format: number, conn: Conn = db): Promise<void> {
  await conn
    .update(repoState)
    .set({ teamClientFormat: sql`GREATEST(${repoState.teamClientFormat}, ${format})` })
    .where(eq(repoState.projectId, projectId));
}

/** 团队接口入口要看的两件事：开启是否已完成、这个团队写入过的最高格式版本。 */
export async function loadTeamGate(
  projectId: string,
  conn: Conn = db,
): Promise<{ ready: boolean; teamClientFormat: number }> {
  const rows = await conn
    .select({ teamReadyAt: repoState.teamReadyAt, teamClientFormat: repoState.teamClientFormat })
    .from(repoState)
    .where(eq(repoState.projectId, projectId))
    .limit(1);
  return { ready: !!rows[0]?.teamReadyAt, teamClientFormat: rows[0]?.teamClientFormat ?? 0 };
}

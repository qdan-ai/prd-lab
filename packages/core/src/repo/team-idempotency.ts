import { and, eq } from "drizzle-orm";
import { idempotencyKeys } from "../db/schema";
import { TeamError } from "./team-errors";
import type { Tx } from "./team-snapshot";
import { errorReply, type TeamReply } from "./team-write";

/**
 * 团队写接口的操作号幂等（接口 10 提交、13、15）：第一次的回复（成功或锁内判出的业务错误）
 * 存进 `idempotency_keys`，键 `team:<项目号>:<操作号>`、按调用者区分；保存期内同一操作号再来，原样返回。
 *
 * 读与写都在写操作的事务里、`repo_state` 行锁到手之后做：同一操作号的两次请求同时到达时，
 * 后到的那次拿到锁时第一次已提交，读到的就是第一次的回复。
 * 存的是锁内判出的结果；事务外就能判出的错误（形状不对、文件没传齐）与锁内的身份、格式复核不存：
 * 补齐、升级之后同一操作号重发照常执行。
 */

/** 保存期（同现有幂等表） */
export const TEAM_OP_TTL_MS = 24 * 3600 * 1000;

export function teamOpKey(projectId: string, opId: string): string {
  return `team:${projectId}:${opId}`;
}

type StoredReply = { status: number; body: unknown };

function isStoredReply(v: unknown): v is StoredReply {
  return typeof v === "object" && v !== null && typeof (v as StoredReply).status === "number" && "body" in v;
}

/** 保存期内这个人用这个操作号得到过的回复；没有返回 null。 */
export async function findTeamOp(
  tx: Tx,
  projectId: string,
  userId: string,
  opId: string,
  now = new Date(),
): Promise<TeamReply | null> {
  const [row] = await tx
    .select({ responseJson: idempotencyKeys.responseJson, createdAt: idempotencyKeys.createdAt })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, teamOpKey(projectId, opId)), eq(idempotencyKeys.userId, userId)));
  if (!row || now.getTime() - row.createdAt.getTime() >= TEAM_OP_TTL_MS) return null;
  return isStoredReply(row.responseJson) ? { status: row.responseJson.status, body: row.responseJson.body } : null;
}

/** 存下这次的回复；保存期已过的旧记录被覆盖。 */
export async function saveTeamOp(
  tx: Tx,
  projectId: string,
  userId: string,
  opId: string,
  reply: TeamReply,
  now = new Date(),
): Promise<void> {
  const responseJson = { status: reply.status, body: reply.body } as object;
  await tx
    .insert(idempotencyKeys)
    .values({ key: teamOpKey(projectId, opId), userId, responseJson, createdAt: now })
    .onDuplicateKeyUpdate({ set: { responseJson, createdAt: now } });
}

/**
 * 在已加锁、已复核身份的事务里执行一次按操作号幂等的操作：保存期内有过回复就原样返回、不再执行；
 * 否则执行 `run`，把它的回复或它抛出的业务错误存下再返回。`run` 必须先做完全部核对再写，
 * 核对不过时只抛 {@link TeamError}，这样存下业务错误的事务里没有别的写入。
 */
export async function runTeamOp(
  tx: Tx,
  projectId: string,
  userId: string,
  opId: string,
  run: () => Promise<TeamReply>,
): Promise<TeamReply> {
  const prior = await findTeamOp(tx, projectId, userId, opId);
  if (prior) return prior;
  let reply: TeamReply;
  try {
    reply = await run();
  } catch (e) {
    if (!(e instanceof TeamError)) throw e;
    reply = errorReply(e);
  }
  await saveTeamOp(tx, projectId, userId, opId, reply);
  return reply;
}

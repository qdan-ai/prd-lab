import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { mergeRequests, teamLineHistory, teamLines, type MergeRequest } from "../db/schema";
import type { MrDetail, MrItem, MrListResponse, MrSubmitRequest, MergeRenames } from "./team-contract";
import { TeamError, validationError } from "./team-errors";
import { noteClientFormat } from "./team-format";
import { runTeamOp } from "./team-idempotency";
import { verifyTeamFileTables } from "./team-init";
import { loadUserRefs, toMrSummary } from "./team-read";
import { insertTeamSnapshot, type Conn, type Tx } from "./team-snapshot";
import { lockTeamWrite, recordTeamEvent, type TeamReply } from "./team-write";

/**
 * 合并请求：提交（接口 10，按操作号幂等）、列表与详情（接口 10）、撤回（接口 11）、退回（接口 12）。
 * 写操作照 team-write 的加锁顺序，在锁内复核调用者仍是成员、角色够。
 */

const MAIN = "main";

export function teamFileList(files: Record<string, { sha256: string; gitMode: string; gitOid: string }>) {
  return Object.entries(files).map(([path, f]) => ({ path, sha256: f.sha256, gitMode: f.gitMode, gitOid: f.gitOid }));
}

/** 提交：存请求的完整样子（团队快照）、项目内顺序号、改动项清单，状态 `open`。 */
export async function submitMr(
  projectId: string,
  userId: string,
  input: MrSubmitRequest,
  clientFormat: number,
): Promise<TeamReply> {
  const sizes = await verifyTeamFileTables(projectId, [{ files: input.files }]);
  return db.transaction(async (tx) => {
    const { state, ownerId } = await lockTeamWrite(tx, projectId, userId, "member", { clientFormat });
    return runTeamOp(tx, projectId, userId, input.opId, async () => {
      const [head] = await tx
        .select({ rev: teamLines.rev })
        .from(teamLines)
        .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, MAIN)));
      const [base] = await tx
        .select({ rev: teamLineHistory.rev })
        .from(teamLineHistory)
        .where(
          and(
            eq(teamLineHistory.projectId, projectId),
            eq(teamLineHistory.line, MAIN),
            eq(teamLineHistory.rev, input.baseRev),
          ),
        );
      if (!base) throw validationError("unknown_base_rev", { baseRev: input.baseRev, rev: head?.rev ?? 0 });

      const snapshotId = await insertTeamSnapshot(tx, {
        projectId,
        versionId: state.teamVersionId,
        uploaderId: userId,
        files: teamFileList(input.files),
        sizes,
        changeNote: `合并请求：${input.title}`,
      });
      const [max] = await tx
        .select({ maxSeq: sql<number | null>`MAX(${mergeRequests.seq})` })
        .from(mergeRequests)
        .where(eq(mergeRequests.projectId, projectId));
      const row: MergeRequest = {
        id: randomUUID(),
        projectId,
        seq: Number(max?.maxSeq ?? 0) + 1,
        line: MAIN,
        authorId: userId,
        deviceId: input.deviceId,
        title: input.title,
        note: input.note,
        items: input.items,
        snapshotId,
        baseRev: input.baseRev,
        status: "open",
        withdrawReason: null,
        returnNote: null,
        decidedBy: null,
        decidedAt: null,
        mergedRev: null,
        createdAt: new Date(),
        renumberMap: null,
      };
      await tx.insert(mergeRequests).values(row);
      await noteClientFormat(projectId, clientFormat, tx);
      await recordTeamEvent(tx, projectId, userId, "mr_submitted", { mrId: row.id, seq: row.seq });
      const refs = await loadUserRefs(projectId, ownerId, [userId], tx);
      return { status: 201, body: { mr: toMrSummary(row, refs) } };
    });
  });
}

/** 列表：按 seq 从新到旧；`after` 是上一页最后一项的 seq。 */
export async function listMrs(
  projectId: string,
  ownerId: string,
  query: { state: "open" | "all"; limit: number; after: number | null },
): Promise<MrListResponse> {
  const where = [eq(mergeRequests.projectId, projectId)];
  if (query.state === "open") where.push(eq(mergeRequests.status, "open"));
  if (query.after !== null) where.push(lt(mergeRequests.seq, query.after));
  const rows = await db
    .select()
    .from(mergeRequests)
    .where(and(...where))
    .orderBy(desc(mergeRequests.seq))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const refs = await loadUserRefs(
    projectId,
    ownerId,
    page.flatMap((r) => [r.authorId, r.decidedBy]),
  );
  return {
    items: page.map((r) => toMrSummary(r, refs)),
    next: rows.length > query.limit ? String(page[page.length - 1]!.seq) : null,
  };
}

/**
 * 详情：摘要 + 说明、改动项、完整样子的快照、改名对照表、同一作者从同一台电脑交的、在它基于的 rev 之后（它之前）已合入的请求。
 * 同一作者在别的电脑交的不算（那台电脑的请求里没有这一台的改动，叠到出发点上会像改了回去）；
 * 早先交的请求没有设备号，来源不明，前序请求为空。
 */
export async function getMr(projectId: string, ownerId: string, mrId: string): Promise<MrDetail> {
  const row = await findMr(db, projectId, mrId);
  const priorWhere = [
    eq(mergeRequests.projectId, projectId),
    eq(mergeRequests.authorId, row.authorId),
    row.deviceId === null ? sql`false` : eq(mergeRequests.deviceId, row.deviceId),
    eq(mergeRequests.status, "merged"),
    ne(mergeRequests.id, row.id),
    gt(mergeRequests.mergedRev, row.baseRev),
  ];
  if (row.mergedRev !== null) priorWhere.push(lt(mergeRequests.mergedRev, row.mergedRev));
  const prior = await db
    .select({
      id: mergeRequests.id,
      seq: mergeRequests.seq,
      mergedRev: mergeRequests.mergedRev,
      renumberMap: mergeRequests.renumberMap,
    })
    .from(mergeRequests)
    .where(and(...priorWhere))
    .orderBy(asc(mergeRequests.mergedRev));
  const refs = await loadUserRefs(projectId, ownerId, [row.authorId, row.decidedBy]);
  return {
    ...toMrSummary(row, refs),
    note: row.note ?? "",
    items: (row.items as MrItem[] | null) ?? [],
    snapshotId: row.snapshotId,
    renumberMap: (row.renumberMap as MergeRenames | null) ?? null,
    priorSameAuthor: prior.map((p) => ({
      id: p.id,
      seq: p.seq,
      mergedRev: p.mergedRev!,
      renumberMap: (p.renumberMap as MergeRenames | null) ?? null,
    })),
  };
}

/** 撤回：只有作者本人；不是待审 → `mr_not_open`。 */
export async function withdrawMr(projectId: string, userId: string, mrId: string): Promise<TeamReply> {
  return db.transaction(async (tx) => {
    const { ownerId } = await lockTeamWrite(tx, projectId, userId, "member");
    const row = await findMr(tx, projectId, mrId, { lock: true });
    if (row.authorId !== userId) throw new TeamError("not_author", "只有作者能撤回");
    if (row.status !== "open") throw new TeamError("mr_not_open", "mr_not_open", { status: row.status });
    return decide(tx, ownerId, row, userId, { status: "withdrawn", withdrawReason: "author" }, "mr_withdrawn");
  });
}

/** 退回：管理员及以上，附一句原因；不是待审 → `mr_not_open`。 */
export async function returnMr(projectId: string, userId: string, mrId: string, note: string): Promise<TeamReply> {
  return db.transaction(async (tx) => {
    const { ownerId } = await lockTeamWrite(tx, projectId, userId, "admin");
    const row = await findMr(tx, projectId, mrId, { lock: true });
    if (row.status !== "open") throw new TeamError("mr_not_open", "mr_not_open", { status: row.status });
    return decide(tx, ownerId, row, userId, { status: "returned", returnNote: note }, "mr_returned");
  });
}

async function decide(
  tx: Tx,
  ownerId: string,
  row: MergeRequest,
  userId: string,
  change: Pick<Partial<MergeRequest>, "status" | "withdrawReason" | "returnNote">,
  event: string,
): Promise<TeamReply> {
  const decided: MergeRequest = { ...row, ...change, decidedAt: new Date(), decidedBy: userId };
  await tx
    .update(mergeRequests)
    .set({ ...change, decidedAt: decided.decidedAt, decidedBy: userId })
    .where(eq(mergeRequests.id, row.id));
  await recordTeamEvent(tx, row.projectId, userId, event, { mrId: row.id, seq: row.seq });
  const refs = await loadUserRefs(row.projectId, ownerId, [row.authorId, userId], tx);
  return { status: 200, body: { mr: toMrSummary(decided, refs) } };
}

/** 这个项目里的一份请求；不在这个项目里 → `not_found`。 */
export async function findMr(
  conn: Conn,
  projectId: string,
  mrId: string,
  opts: { lock?: boolean } = {},
): Promise<MergeRequest> {
  const q = conn
    .select()
    .from(mergeRequests)
    .where(and(eq(mergeRequests.id, mrId), eq(mergeRequests.projectId, projectId)));
  const [row] = opts.lock ? await q.for("update") : await q;
  if (!row) throw new TeamError("not_found");
  return row;
}

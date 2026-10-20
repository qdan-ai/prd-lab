import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { mergeRequests, teamLineHistory, teamLines, type MergeRequest } from "../db/schema";
import type { AdvanceRequest, TeamLineHead } from "./team-contract";
import { TeamError, validationError } from "./team-errors";
import { noteClientFormat } from "./team-format";
import { runTeamOp } from "./team-idempotency";
import { verifyTeamFileTables } from "./team-init";
import { findMr, teamFileList } from "./team-mr";
import { loadUserRefs, toMrSummary, userRef } from "./team-read";
import { insertTeamSnapshot } from "./team-snapshot";
import { lockTeamWrite, recordTeamEvent, type TeamReply } from "./team-write";

/**
 * 合入（接口 13）：团队主线先到先得地前进一格。
 * 一个事务里：锁内复核操作者仍是管理员及以上 → 核对 `expectedRev` 等于现在的 rev（否则 `head_moved`）
 * → 请求仍待审（否则 `mr_not_open`）→ 存合入后的样子、主线 rev 加一、记历史、请求标已合入并存改号对照表、
 * 存操作结果、记事件。同一操作号重试原样返回第一次的结果。
 */
export async function advanceLine(
  projectId: string,
  userId: string,
  line: string,
  input: AdvanceRequest,
  clientFormat: number,
): Promise<TeamReply> {
  if (line !== "main") throw validationError("line_not_supported", { line });
  const sizes = await verifyTeamFileTables(projectId, [{ files: input.files }]);
  return db.transaction(async (tx) => {
    const { state, ownerId } = await lockTeamWrite(tx, projectId, userId, "admin", { clientFormat });
    return runTeamOp(tx, projectId, userId, input.opId, async () => {
      const mr = await findMr(tx, projectId, input.mrId, { lock: true });
      const [head] = await tx
        .select()
        .from(teamLines)
        .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, line)));
      if (!head) throw new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作");
      if (head.rev !== input.expectedRev) {
        throw new TeamError("head_moved", "head_moved", { line, rev: head.rev, headSnapshotId: head.headSnapshotId });
      }
      if (mr.status !== "open") throw new TeamError("mr_not_open", "mr_not_open", { status: mr.status });

      const snapshotId = await insertTeamSnapshot(tx, {
        projectId,
        versionId: state.teamVersionId,
        uploaderId: userId,
        files: teamFileList(input.files),
        sizes,
        changeNote: `合入 #${mr.seq}`,
      });
      const now = new Date();
      const rev = head.rev + 1;
      await tx
        .update(teamLines)
        .set({ rev, headSnapshotId: snapshotId, updatedBy: userId, updatedAt: now })
        .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, line)));
      await tx.insert(teamLineHistory).values({
        projectId,
        line,
        rev,
        snapshotId,
        reason: "merge",
        mrId: mr.id,
        byUserId: userId,
        at: now,
      });
      const merged: MergeRequest = {
        ...mr,
        status: "merged",
        mergedRev: rev,
        decidedAt: now,
        decidedBy: userId,
        renumberMap: input.renumberMap,
      };
      await tx
        .update(mergeRequests)
        .set({ status: "merged", mergedRev: rev, decidedAt: now, decidedBy: userId, renumberMap: input.renumberMap })
        .where(eq(mergeRequests.id, mr.id));
      await noteClientFormat(projectId, clientFormat, tx);
      await recordTeamEvent(tx, projectId, userId, "mr_merged", { mrId: mr.id, seq: mr.seq, rev });

      const refs = await loadUserRefs(projectId, ownerId, [mr.authorId, userId], tx);
      const lineHead: TeamLineHead = {
        line: "main",
        rev,
        headSnapshotId: snapshotId,
        baseVersionKey: head.baseVersionKey ?? null,
        updatedAt: now.toISOString(),
        updatedBy: userRef(refs, userId),
      };
      return { status: 200, body: { line: lineHead, mr: toMrSummary(merged, refs) } };
    });
  });
}

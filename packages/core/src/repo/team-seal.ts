import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { repoState, repoVersions, teamLineHistory, teamLines, teamSealing } from "../db/schema";
import { contentDigest, draftKey } from "./digest";
import { REPO_FORMAT, checkChangeManifest } from "./manifest";
import { guestRenderer } from "./sync";
import type {
  GuestDraftPutRequest,
  Online,
  OnlinePutRequest,
  SealRequest,
  SealingEntry,
  TeamLineHead,
  TeamVersion,
  TeamVersionRecord,
} from "./team-contract";
import { TeamError, validationError } from "./team-errors";
import { noteClientFormat } from "./team-format";
import { runTeamOp } from "./team-idempotency";
import { assertCommitMatches, verifyTeamFileTables } from "./team-init";
import { teamFileList } from "./team-mr";
import {
  SEALING_STALE_MS,
  TEAM_EVENT_VERSION_SEALED,
  loadTeamRecords,
  loadUserRefs,
  userRef,
} from "./team-read";
import { insertTeamSnapshot, type Conn, type Tx } from "./team-snapshot";
import { lockTeamWrite, recordTeamEvent, verifyPlainFiles, type LockedTeam, type TeamReply } from "./team-write";

/**
 * 团队封版（接口 15，按操作号幂等）、「正在封版」（接口 14）、上线标记（接口 16）、访客草稿（接口 21）。
 * 写操作照 team-write 的加锁顺序；版本记录、上线标记、访客草稿每改一次 `state_rev` 加一，
 * 请求带的「已应用的状态号」与它不同 → `state_changed`（带最新的整份记录）。
 */

const MAIN = "main";

/** `state_changed`：带上现在的状态号与整份记录，G-canvas 吸收后重发。 */
async function stateChanged(locked: LockedTeam): Promise<TeamError> {
  return new TeamError("state_changed", "state_changed", {
    stateRev: locked.state.stateRev,
    records: await loadTeamRecords(locked.state.projectId, locked.ownerId, locked.state),
  });
}

/** 版本记录、上线标记、访客草稿改了一次：`state_rev` 加一（访客看到的内容随之变化，记为最近推送），返回新值。 */
async function bumpStateRev(tx: Tx, locked: LockedTeam, userId: string, now: Date): Promise<number> {
  await tx
    .update(repoState)
    .set({ stateRev: sql`${repoState.stateRev} + 1`, format: REPO_FORMAT, lastPushedAt: now, lastPushedBy: userId })
    .where(eq(repoState.projectId, locked.state.projectId));
  return locked.state.stateRev + 1;
}

/** 团队里的全部版本（有完整版本记录与团队快照的行），按写入先后。 */
async function loadTeamVersionRecords(conn: Conn, projectId: string) {
  const rows = await conn
    .select({ key: repoVersions.key, record: repoVersions.teamRecord })
    .from(repoVersions)
    .where(
      and(
        eq(repoVersions.projectId, projectId),
        isNotNull(repoVersions.teamRecord),
        isNotNull(repoVersions.teamSnapshotId),
        inArray(repoVersions.kind, ["version", "baseline"]),
      ),
    )
    .orderBy(asc(repoVersions.createdAt), asc(repoVersions.id));
  return rows.map((r) => ({ key: r.key, record: r.record as TeamVersionRecord }));
}

/**
 * 补丁线现在最新的版本：这条线上的版本按父版本连成一串，取没有被别的版本当作父版本的那一个；
 * 这条线上还没有版本时 = 被修版本。
 */
function patchLineTip(line: string, versions: Array<{ key: string; record: TeamVersionRecord }>): string {
  const onLine = versions.filter((v) => v.record.line === line);
  const parents = new Set(onLine.map((v) => v.record.parentKey));
  const tips = onLine.filter((v) => !parents.has(v.key));
  // 同时有几个末端（不该出现）时取最晚写入的
  return tips.length > 0 ? tips[tips.length - 1]!.key : line.slice("patch:".length);
}

// ---------------------------------------------------------------------------
// 封版
// ---------------------------------------------------------------------------

/**
 * 一个事务里，按契约的顺序核对：`expectedRev`（主线，`head_moved`）→ 新版本的父版本就是这条线现在最新的版本
 * （`version_parent_moved`）→ `appliedStateRev`（`state_changed`）→ 版本号没被占用（`number_duplicate`）；
 * 都过了才建版本（团队快照 + 访客快照）、主线前进一格并记封出的版本、`state_rev` 加一、清掉我在这条线上的
 * 「正在封版」、记封版事件（团队状态据此给出 `sealer`）、存操作结果。补丁线没有团队主线，不核 rev。
 */
export async function sealLine(
  projectId: string,
  userId: string,
  line: string,
  input: SealRequest,
  clientFormat: number,
): Promise<TeamReply> {
  const v = input.version;
  if (v.record.key !== v.key) throw validationError("record_key_mismatch", { key: v.key });
  if (v.record.line !== line) throw validationError("line_mismatch", { line, recordLine: v.record.line });
  assertCommitMatches(v.key, v.commitRaw);
  const isMain = line === MAIN;
  if (isMain && input.expectedRev === null) throw validationError("expected_rev_required");
  if (isMain && input.head === null) throw validationError("head_required");
  if (!isMain && (input.expectedRev !== null || input.head !== null)) throw validationError("patch_line_has_no_head");

  const sizes = await verifyTeamFileTables(projectId, [
    { key: v.key, files: v.files },
    ...(input.head ? [{ files: input.head.files }] : []),
  ]);
  const guest = await verifyPlainFiles(projectId, v.guest.files);
  const renderer = await guestRenderer(projectId, v.key, guest.files, guest.sizes);
  const guestDigest = contentDigest(guest.files);
  const manifest =
    v.guest.manifest !== undefined && checkChangeManifest(v.guest.manifest, v.key, guestDigest) === null
      ? v.guest.manifest
      : null;

  return db.transaction(async (tx) => {
    const locked = await lockTeamWrite(tx, projectId, userId, "admin", { clientFormat });
    const { state } = locked;
    return runTeamOp(tx, projectId, userId, input.opId, async () => {
      let head: typeof teamLines.$inferSelect | undefined;
      if (isMain) {
        [head] = await tx
          .select()
          .from(teamLines)
          .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, MAIN)));
        if (!head) throw new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作");
        if (head.rev !== input.expectedRev) {
          throw new TeamError("head_moved", "head_moved", { line, rev: head.rev, headSnapshotId: head.headSnapshotId });
        }
      }
      const versions = await loadTeamVersionRecords(tx, projectId);
      const latest = head ? (head.baseVersionKey ?? null) : patchLineTip(line, versions);
      if (v.record.parentKey !== latest) {
        const records = await loadTeamRecords(projectId, locked.ownerId, state);
        const hit = records.versions.find((x) => x.key === latest);
        if (!hit) throw validationError("parent_mismatch", { line, parentKey: v.record.parentKey });
        throw new TeamError("version_parent_moved", "version_parent_moved", {
          line,
          latest: { key: hit.key, number: hit.record.number, sealer: hit.sealer, sealedAt: hit.record.sealedAt },
        });
      }
      if (input.appliedStateRev !== state.stateRev) throw await stateChanged(locked);
      const taken = versions.find((x) => x.record.number === v.record.number && !x.record.withdrawnAt);
      if (taken) throw new TeamError("number_duplicate", "number_duplicate", { number: v.record.number, key: taken.key });

      // ---- 核对都过了：落库 ----
      const r = v.record;
      const now = new Date();
      const guestSnapshotId = await insertTeamSnapshot(tx, {
        projectId,
        versionId: state.versionId,
        uploaderId: userId,
        files: guest.files,
        sizes: guest.sizes,
        changeNote: `G-canvas 团队封版 ${r.number}`,
        audience: "guest",
        renderer,
      });
      const teamSnapshotId = await insertTeamSnapshot(tx, {
        projectId,
        versionId: state.teamVersionId,
        uploaderId: userId,
        files: teamFileList(v.files),
        sizes,
        changeNote: `团队封版 ${r.number}`,
      });
      await tx.insert(repoVersions).values({
        projectId,
        key: v.key,
        snapshotId: guestSnapshotId,
        kind: r.kind === "baseline" ? "baseline" : "version",
        number: r.number,
        name: r.name,
        summary: r.summary,
        line: r.line,
        parentKey: r.parentKey,
        patchOf: r.patchOf,
        sealedAt: new Date(r.sealedAt),
        changes: v.guest.changes as object | null,
        specDocs: r.specDocs,
        manifest: manifest as object | null,
        teamSnapshotId,
        commitRawB64: v.commitRaw,
        teamRecord: r,
        createdAt: now,
        updatedAt: now,
      });

      const refs = await loadUserRefs(projectId, locked.ownerId, [userId], tx);
      let lineHead: TeamLineHead | null = null;
      if (head && input.head) {
        const headSnapshotId = await insertTeamSnapshot(tx, {
          projectId,
          versionId: state.teamVersionId,
          uploaderId: userId,
          files: teamFileList(input.head.files),
          sizes,
          changeNote: `封版 ${r.number} 后的团队主线`,
        });
        const rev = head.rev + 1;
        await tx
          .update(teamLines)
          .set({ rev, headSnapshotId, baseVersionKey: v.key, updatedBy: userId, updatedAt: now })
          .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, MAIN)));
        await tx.insert(teamLineHistory).values({
          projectId,
          line: MAIN,
          rev,
          snapshotId: headSnapshotId,
          reason: "seal",
          versionKey: v.key,
          byUserId: userId,
          at: now,
        });
        lineHead = {
          line: "main",
          rev,
          headSnapshotId,
          baseVersionKey: v.key,
          updatedAt: now.toISOString(),
          updatedBy: userRef(refs, userId),
        };
      }
      const stateRev = await bumpStateRev(tx, locked, userId, now);
      await tx
        .delete(teamSealing)
        .where(and(eq(teamSealing.projectId, projectId), eq(teamSealing.line, line), eq(teamSealing.userId, userId)));
      await noteClientFormat(projectId, clientFormat, tx);
      await recordTeamEvent(tx, projectId, userId, TEAM_EVENT_VERSION_SEALED, { key: v.key, line, number: r.number });

      const version: TeamVersion = {
        key: v.key,
        record: r,
        commitRaw: v.commitRaw,
        teamSnapshotId,
        sealer: userRef(refs, userId),
        pushedAt: now.toISOString(),
      };
      return { status: 200, body: { version, line: lineHead, stateRev } };
    });
  });
}

// ---------------------------------------------------------------------------
// 「正在封版」
// ---------------------------------------------------------------------------

/** 上报或续报：第一次（或上一条已过期）建一条，`since` = 现在；之后只更新 `seenAt`。 */
export async function putSealing(
  projectId: string,
  userId: string,
  input: { line: string; deviceId: string },
): Promise<TeamReply> {
  return db.transaction(async (tx) => {
    const { ownerId } = await lockTeamWrite(tx, projectId, userId, "admin");
    const where = and(
      eq(teamSealing.projectId, projectId),
      eq(teamSealing.line, input.line),
      eq(teamSealing.userId, userId),
      eq(teamSealing.deviceId, input.deviceId),
    );
    const [existing] = await tx.select().from(teamSealing).where(where);
    const now = new Date();
    let since = now;
    if (!existing) {
      await tx
        .insert(teamSealing)
        .values({ projectId, line: input.line, userId, deviceId: input.deviceId, since: now, seenAt: now });
    } else {
      if (now.getTime() - existing.seenAt.getTime() <= SEALING_STALE_MS) since = existing.since;
      await tx.update(teamSealing).set({ since, seenAt: now }).where(where);
    }
    const refs = await loadUserRefs(projectId, ownerId, [userId], tx);
    const sealing: SealingEntry = {
      line: input.line as SealingEntry["line"],
      user: userRef(refs, userId),
      deviceId: input.deviceId,
      since: since.toISOString(),
      seenAt: now.toISOString(),
    };
    return { status: 200, body: { sealing } };
  });
}

/** 清掉我这台设备在这条线上的「正在封版」；本来就没有也算成功。 */
export async function deleteSealing(
  projectId: string,
  userId: string,
  input: { line: string; deviceId: string },
): Promise<TeamReply> {
  return db.transaction(async (tx) => {
    await lockTeamWrite(tx, projectId, userId, "admin");
    await tx
      .delete(teamSealing)
      .where(
        and(
          eq(teamSealing.projectId, projectId),
          eq(teamSealing.line, input.line),
          eq(teamSealing.userId, userId),
          eq(teamSealing.deviceId, input.deviceId),
        ),
      );
    return { status: 200, body: { ok: true } };
  });
}

// ---------------------------------------------------------------------------
// 上线标记
// ---------------------------------------------------------------------------

function onlineOf(state: { onlineKey: string | null; onlinePeriods: unknown }): Online {
  return {
    key: state.onlineKey,
    periods: Array.isArray(state.onlinePeriods) ? (state.onlinePeriods as Online["periods"]) : [],
  };
}

/**
 * 一次明确的操作：贴到 `key`（贴上或回滚）或摘下（null）。贴到新版本时把在线的那段收尾、开一段新的；
 * 摘下只收尾；贴到已在线的版本什么都不变（`state_rev` 不加）。
 */
export async function putOnline(
  projectId: string,
  userId: string,
  input: OnlinePutRequest,
  clientFormat: number,
): Promise<TeamReply> {
  return db.transaction(async (tx) => {
    const locked = await lockTeamWrite(tx, projectId, userId, "admin", { clientFormat });
    const { state } = locked;
    if (input.key !== null && !(await loadTeamVersionRecords(tx, projectId)).some((x) => x.key === input.key)) {
      throw validationError("unknown_version", { key: input.key });
    }
    if (input.appliedStateRev !== state.stateRev) throw await stateChanged(locked);
    const online = onlineOf(state);
    if (online.key === input.key) return { status: 200, body: { stateRev: state.stateRev, online } };

    const now = new Date();
    const at = now.toISOString();
    const periods = online.periods.map((p) => (p.to === null ? { ...p, to: at } : p));
    if (input.key !== null) periods.push({ key: input.key, from: at, to: null });
    await tx
      .update(repoState)
      .set({ onlineKey: input.key, onlinePeriods: periods })
      .where(eq(repoState.projectId, projectId));
    const stateRev = await bumpStateRev(tx, locked, userId, now);
    await recordTeamEvent(tx, projectId, userId, "online_changed", { key: input.key });
    return { status: 200, body: { stateRev, online: { key: input.key, periods } } };
  });
}

// ---------------------------------------------------------------------------
// 访客草稿
// ---------------------------------------------------------------------------

/** 团队发布的访客草稿在草稿行的 team_record 里记着来自团队主线的哪个 rev */
const draftRevOf = (teamRecord: unknown): number | null => {
  const rev = (teamRecord as { rev?: unknown } | null)?.rev;
  return typeof rev === "number" ? rev : null;
};

/**
 * 把团队主线某个 rev 的访客文件表发布为访客草稿。草稿 key 按现有规则由线、基于的版本
 * （这个 rev 时主线最新的版本）、内容指纹派生；同一时刻最多一份未撤下的草稿。
 * 与现有草稿完全相同（同 key、同 rev）时什么都不变。
 */
export async function putGuestDraft(
  projectId: string,
  userId: string,
  input: GuestDraftPutRequest,
  clientFormat: number,
): Promise<TeamReply> {
  const guest = await verifyPlainFiles(projectId, input.files);
  const renderer = await guestRenderer(projectId, "guest-draft", guest.files, guest.sizes);
  const digest = contentDigest(guest.files);
  return db.transaction(async (tx) => {
    const locked = await lockTeamWrite(tx, projectId, userId, "admin", { clientFormat });
    const { state } = locked;
    const history = await tx
      .select({ rev: teamLineHistory.rev, reason: teamLineHistory.reason, versionKey: teamLineHistory.versionKey })
      .from(teamLineHistory)
      .where(and(eq(teamLineHistory.projectId, projectId), eq(teamLineHistory.line, MAIN)))
      .orderBy(asc(teamLineHistory.rev));
    if (!history.some((h) => h.rev === input.rev)) {
      throw validationError("unknown_rev", { rev: input.rev, current: history[history.length - 1]?.rev ?? 0 });
    }
    if (input.appliedStateRev !== state.stateRev) throw await stateChanged(locked);

    const basedOn = await basedOnAt(tx, projectId, input.rev, history);
    const key = draftKey(MAIN, basedOn, digest);
    const drafts = await tx
      .select({ key: repoVersions.key, teamRecord: repoVersions.teamRecord, withdrawnAt: repoVersions.withdrawnAt })
      .from(repoVersions)
      .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.kind, "draft")));
    const live = drafts.filter((d) => d.withdrawnAt === null);
    let stateRev = state.stateRev;
    const unchanged = live.length === 1 && live[0]!.key === key && draftRevOf(live[0]!.teamRecord) === input.rev;
    if (!unchanged) {
      const now = new Date();
      await tx
        .update(repoVersions)
        .set({ withdrawnAt: now, updatedAt: now })
        .where(
          and(
            eq(repoVersions.projectId, projectId),
            eq(repoVersions.kind, "draft"),
            isNull(repoVersions.withdrawnAt),
            ne(repoVersions.key, key),
          ),
        );
      if (drafts.some((d) => d.key === key)) {
        await tx
          .update(repoVersions)
          .set({ withdrawnAt: null, teamRecord: { rev: input.rev }, updatedAt: now })
          .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.key, key)));
      } else {
        const snapshotId = await insertTeamSnapshot(tx, {
          projectId,
          versionId: state.versionId,
          uploaderId: userId,
          files: guest.files,
          sizes: guest.sizes,
          changeNote: `G-canvas 团队访客草稿（主线 rev ${input.rev}）`,
          audience: "guest",
          renderer,
        });
        await tx.insert(repoVersions).values({
          projectId,
          key,
          snapshotId,
          kind: "draft",
          line: MAIN,
          parentKey: basedOn,
          teamRecord: { rev: input.rev },
          createdAt: now,
          updatedAt: now,
        });
      }
      stateRev = await bumpStateRev(tx, locked, userId, now);
      await recordTeamEvent(tx, projectId, userId, "guest_draft_published", { key, rev: input.rev });
    }
    await noteClientFormat(projectId, clientFormat, tx);
    const [row] = await tx
      .select({ updatedAt: repoVersions.updatedAt })
      .from(repoVersions)
      .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.key, key)));
    return {
      status: 200,
      body: {
        stateRev,
        guestDraft: {
          key,
          line: "main",
          rev: input.rev,
          basedOn,
          contentDigest: digest,
          pushedAt: row!.updatedAt.toISOString(),
        },
      },
    };
  });
}

/** 撤下访客草稿；本来就没有时什么都不变。 */
export async function deleteGuestDraft(projectId: string, userId: string, appliedStateRev: number): Promise<TeamReply> {
  return db.transaction(async (tx) => {
    const locked = await lockTeamWrite(tx, projectId, userId, "admin");
    if (appliedStateRev !== locked.state.stateRev) throw await stateChanged(locked);
    const live = await tx
      .select({ key: repoVersions.key })
      .from(repoVersions)
      .where(
        and(eq(repoVersions.projectId, projectId), eq(repoVersions.kind, "draft"), isNull(repoVersions.withdrawnAt)),
      );
    if (live.length === 0) return { status: 200, body: { stateRev: locked.state.stateRev } };
    const now = new Date();
    await tx
      .update(repoVersions)
      .set({ withdrawnAt: now, updatedAt: now })
      .where(
        and(eq(repoVersions.projectId, projectId), eq(repoVersions.kind, "draft"), isNull(repoVersions.withdrawnAt)),
      );
    const stateRev = await bumpStateRev(tx, locked, userId, now);
    await recordTeamEvent(tx, projectId, userId, "guest_draft_withdrawn", { keys: live.map((d) => d.key) });
    return { status: 200, body: { stateRev } };
  });
}

/**
 * 主线在某个 rev 时最新的版本：这个 rev 及以前最后一次封版封出的版本；在它之前团队还没封过版时，
 * 是之后第一次封版的父版本，或（之后也没封过）团队主线现在记着的最新版本（开启时的初值）。
 */
async function basedOnAt(
  conn: Conn,
  projectId: string,
  rev: number,
  history: Array<{ rev: number; reason: string; versionKey: string | null }>,
): Promise<string | null> {
  const seals = history.filter((h) => h.reason === "seal" && h.versionKey);
  const before = seals.filter((h) => h.rev <= rev);
  if (before.length > 0) return before[before.length - 1]!.versionKey;
  const after = seals.find((h) => h.rev > rev);
  if (after) {
    const versions = await loadTeamVersionRecords(conn, projectId);
    return versions.find((x) => x.key === after.versionKey)?.record.parentKey ?? null;
  }
  const [head] = await conn
    .select({ baseVersionKey: teamLines.baseVersionKey })
    .from(teamLines)
    .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, MAIN)));
  return head?.baseVersionKey ?? null;
}

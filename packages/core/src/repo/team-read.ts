import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  mergeRequests,
  projectMembers,
  projects,
  repoBlobs,
  repoState,
  repoVersions,
  snapshots,
  teamDiscussions,
  teamEvents,
  teamLineHistory,
  teamLines,
  teamProgress,
  teamSealing,
  users,
  versions,
} from "../db/schema";
import { blobS3Key } from "./digest";
import {
  checkShape,
  IdLedger,
  OnlinePeriod,
  TEAM_LIMITS,
  type IdLedger as IdLedgerType,
  type LineHistoryEntry,
  type MrSummary,
  type MyMergedMr,
  type Online,
  type SealingEntry,
  type TeamLineHead,
  type TeamListedFile,
  type TeamProjectsResponse,
  type TeamRecords,
  type TeamState,
  type TeamStart,
  type UserRef,
} from "./team-contract";
import { TeamError, validationError } from "./team-errors";
import { minClientFormatOf } from "./team-format";
import { lockRepoState, loadSnapshotFiles, type Conn, type Tx } from "./team-snapshot";
import type { TeamRole } from "./team-guard";

/** 事件类型：团队版本封出（`actor_id` = 封版人，`payload = { key }`）。接口 15 写入，团队状态据此给出版本的 `sealer`。 */
export const TEAM_EVENT_VERSION_SEALED = "version_sealed";

/** 「正在封版」超过这么久没续报视为没有。 */
export const SEALING_STALE_MS = 30 * 60 * 1000;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------
// 用户引用
// ---------------------------------------------------------------------------

/**
 * 一批用户的 `{ id, name, removed }`。`removed` = 在这个项目里没有未移除的成员行、也不是负责人（主人）。
 * 查不到的用户号不在结果里，调用方用 {@link userRef} 取。
 */
export async function loadUserRefs(
  projectId: string,
  ownerId: string,
  userIds: Array<string | null | undefined>,
  conn: Conn = db,
): Promise<Map<string, UserRef>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const out = new Map<string, UserRef>();
  if (ids.length === 0) return out;
  const [names, active] = await Promise.all([
    conn.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)),
    conn
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          isNull(projectMembers.removedAt),
          inArray(projectMembers.userId, ids),
        ),
      ),
  ]);
  const activeIds = new Set(active.map((r) => r.userId));
  for (const u of names) out.set(u.id, { id: u.id, name: u.name, removed: !(activeIds.has(u.id) || u.id === ownerId) });
  return out;
}

export function userRef(refs: Map<string, UserRef>, id: string | null | undefined): UserRef {
  const hit = id ? refs.get(id) : undefined;
  return hit ?? { id: id ?? "unknown", name: "未知用户", removed: true };
}

// ---------------------------------------------------------------------------
// 编号账
// ---------------------------------------------------------------------------

export function emptyLedger(): IdLedgerType {
  return { elements: {}, states: {} };
}

/** 读库里存的编号账；空或不合形状的当作空账。 */
export function parseStoredLedger(value: unknown): IdLedgerType {
  if (value && checkShape(IdLedger, value).length === 0) return value as IdLedgerType;
  return emptyLedger();
}

/** 并入：按项取较大值。 */
export function mergeLedgers(a: IdLedgerType, b: IdLedgerType): IdLedgerType {
  const mergeDict = (x: Record<string, number>, y: Record<string, number>) => {
    const out: Record<string, number> = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  return { elements: mergeDict(a.elements, b.elements), states: mergeDict(a.states, b.states) };
}

/** 请求里的编号账不合形状 → `invalid_ids`，`details.at` 指出是元素还是状态部分。 */
export function checkIncomingLedger(ids: unknown): IdLedgerType {
  const problems = checkShape(IdLedger, ids, "ids");
  if (problems.length > 0) {
    const at = /^ids\.(elements|states)/.exec(problems[0]!)?.[0] ?? "ids";
    throw validationError("invalid_ids", { at, problems: problems.slice(0, 5) });
  }
  return ids as IdLedgerType;
}

export type LedgerWant = { elements?: Record<string, number>; states?: Record<string, number> };
export type LedgerGrant = {
  elements: Record<string, string[]>;
  states: Record<string, number[]>;
};

/** 领新号：先并入 `incoming`，再给每项领出 `want` 里要的个数；账与领号在同一事务里写回。 */
export async function grantLedgerIds(
  projectId: string,
  incoming: IdLedgerType,
  want: LedgerWant,
): Promise<{ ids: IdLedgerType; granted: LedgerGrant }> {
  return db.transaction(async (tx) => {
    const state = await lockRepoState(tx, projectId);
    if (!state) throw new TeamError("not_found");
    const ledger = mergeLedgers(parseStoredLedger(state.idLedger), incoming);
    const granted: LedgerGrant = { elements: {}, states: {} };
    for (const [prefix, n] of Object.entries(want.elements ?? {})) {
      const from = ledger.elements[prefix] ?? 0;
      granted.elements[prefix] = Array.from({ length: n }, (_, i) => `${prefix}${from + 1 + i}`);
      ledger.elements[prefix] = from + n;
    }
    for (const [object, n] of Object.entries(want.states ?? {})) {
      const from = ledger.states[object] ?? 0;
      granted.states[object] = Array.from({ length: n }, (_, i) => from + 1 + i);
      ledger.states[object] = from + n;
    }
    await tx.update(repoState).set({ idLedger: ledger }).where(eq(repoState.projectId, projectId));
    return { ids: ledger, granted };
  });
}

// ---------------------------------------------------------------------------
// 合并请求摘要（团队状态、列表共用）
// ---------------------------------------------------------------------------

type MrRow = typeof mergeRequests.$inferSelect;

export function toMrSummary(row: MrRow, refs: Map<string, UserRef>): MrSummary {
  return {
    id: row.id,
    seq: row.seq,
    line: "main",
    author: userRef(refs, row.authorId),
    title: row.title,
    itemCount: Array.isArray(row.items) ? row.items.length : 0,
    status: row.status,
    withdrawReason: row.withdrawReason ?? null,
    baseRev: row.baseRev,
    mergedRev: row.mergedRev ?? null,
    createdAt: iso(row.createdAt),
    decidedAt: isoOrNull(row.decidedAt),
    decidedBy: row.decidedBy ? userRef(refs, row.decidedBy) : null,
    returnNote: row.returnNote ?? null,
  };
}

// ---------------------------------------------------------------------------
// 接口 1：我所在的团队项目
// ---------------------------------------------------------------------------

export async function listMyTeamProjects(userId: string): Promise<TeamProjectsResponse["projects"]> {
  const mine = await db
    .select({
      id: projects.id,
      name: projects.name,
      ownerId: projects.ownerId,
      teamReadyAt: repoState.teamReadyAt,
    })
    .from(projects)
    .innerJoin(repoState, eq(repoState.projectId, projects.id))
    .where(
      and(
        isNull(projects.archivedAt),
        eq(projects.kind, "repo"),
        isNotNull(repoState.teamReadyAt),
        or(
          eq(projects.ownerId, userId),
          sql`EXISTS (SELECT 1 FROM ${projectMembers} WHERE ${projectMembers.projectId} = ${projects.id}
            AND ${projectMembers.userId} = ${userId} AND ${projectMembers.removedAt} IS NULL)`,
        ),
      ),
    )
    .orderBy(desc(repoState.teamReadyAt));
  if (mine.length === 0) return [];
  const pids = mine.map((p) => p.id);

  const [roles, lineRows, openCounts, myMrs, owners] = await Promise.all([
    db
      .select({ projectId: projectMembers.projectId, role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          inArray(projectMembers.projectId, pids),
          eq(projectMembers.userId, userId),
          isNull(projectMembers.removedAt),
        ),
      ),
    db
      .select({ projectId: teamLines.projectId, rev: teamLines.rev })
      .from(teamLines)
      .where(and(inArray(teamLines.projectId, pids), eq(teamLines.line, "main"))),
    db
      .select({ projectId: mergeRequests.projectId, n: count(mergeRequests.id) })
      .from(mergeRequests)
      .where(and(inArray(mergeRequests.projectId, pids), eq(mergeRequests.status, "open")))
      .groupBy(mergeRequests.projectId),
    db
      .select()
      .from(mergeRequests)
      .where(and(inArray(mergeRequests.projectId, pids), eq(mergeRequests.authorId, userId)))
      .orderBy(desc(mergeRequests.seq)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...new Set(mine.map((p) => p.ownerId))])),
  ]);
  const roleOf = new Map(roles.map((r) => [r.projectId, r.role]));
  const revOf = new Map(lineRows.map((r) => [r.projectId, r.rev]));
  const openOf = new Map(openCounts.map((r) => [r.projectId, Number(r.n)]));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));

  return mine.flatMap((p) => {
    const rev = revOf.get(p.id);
    if (rev === undefined || !p.teamReadyAt) return [];
    const myRows = myMrs.filter((m) => m.projectId === p.id);
    const decided = myRows
      .filter((m) => m.status !== "open" && m.decidedAt)
      .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())
      .slice(0, 10);
    const lastSubmitted = myRows.reduce<Date | null>((acc, m) => (!acc || m.createdAt > acc ? m.createdAt : acc), null);
    return [
      {
        id: p.id,
        name: p.name,
        lead: { id: p.ownerId, name: ownerName.get(p.ownerId) ?? "未知用户", removed: false },
        role: (p.ownerId === userId ? "lead" : (roleOf.get(p.id) ?? "member")) as TeamRole,
        rev,
        teamReadyAt: iso(p.teamReadyAt),
        openMrCount: openOf.get(p.id) ?? 0,
        mine: {
          lastSubmittedAt: isoOrNull(lastSubmitted),
          recentDecided: decided.map((m) => ({
            id: m.id,
            seq: m.seq,
            status: m.status as "merged" | "returned" | "withdrawn",
            mergedRev: m.mergedRev ?? null,
            decidedAt: iso(m.decidedAt!),
          })),
        },
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// 接口 4：团队状态与刷新
// ---------------------------------------------------------------------------

export type StateQueryInput = {
  /** 本机已应用的状态号；等于现在的 `stateRev` 时不重发 `records` */
  appliedStateRev: number | null;
  /** 取这条线的历史；缺省 `main` */
  line?: string;
  /** 取这个 rev 之后的历史；缺省或 null 时 `history` 为空 */
  baseRev?: number | null;
};

/** 团队状态。调用方已确认调用者是未移除的成员、项目已开启完成。 */
export async function loadTeamState(
  projectId: string,
  me: { userId: string; role: TeamRole },
  query: StateQueryInput,
): Promise<TeamState> {
  const head = await db
    .select({
      name: projects.name,
      ownerId: projects.ownerId,
      state: repoState,
    })
    .from(projects)
    .innerJoin(repoState, eq(repoState.projectId, projects.id))
    .where(eq(projects.id, projectId))
    .limit(1);
  const row = head[0];
  if (!row || !row.state.teamReadyAt || !row.state.teamSince) throw new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作");
  const st = row.state;
  const teamSince = row.state.teamSince;
  const teamReadyAt = row.state.teamReadyAt;
  const line = query.line ?? "main";
  const baseRev = query.baseRev ?? null;

  const [lineRows, historyRows, memberRows, sealingRows, openRows, myRows, discussionRows, progressRows] =
    await Promise.all([
      db.select().from(teamLines).where(eq(teamLines.projectId, projectId)).orderBy(asc(teamLines.line)),
      line === "main" && baseRev !== null
        ? db
            .select()
            .from(teamLineHistory)
            .where(
              and(
                eq(teamLineHistory.projectId, projectId),
                eq(teamLineHistory.line, "main"),
                gt(teamLineHistory.rev, baseRev),
              ),
            )
            .orderBy(asc(teamLineHistory.rev))
        : Promise.resolve([]),
      db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).orderBy(asc(projectMembers.addedAt)),
      db
        .select()
        .from(teamSealing)
        .where(
          and(eq(teamSealing.projectId, projectId), gt(teamSealing.seenAt, new Date(Date.now() - SEALING_STALE_MS))),
        )
        .orderBy(asc(teamSealing.since)),
      db
        .select()
        .from(mergeRequests)
        .where(and(eq(mergeRequests.projectId, projectId), eq(mergeRequests.status, "open")))
        .orderBy(desc(mergeRequests.seq)),
      db
        .select()
        .from(mergeRequests)
        .where(and(eq(mergeRequests.projectId, projectId), eq(mergeRequests.authorId, me.userId)))
        .orderBy(desc(mergeRequests.seq)),
      db
        .select({
          authorId: teamDiscussions.authorId,
          snapshotId: teamDiscussions.snapshotId,
          pushedAt: teamDiscussions.pushedAt,
          contentDigest: snapshots.contentSha256,
        })
        .from(teamDiscussions)
        .innerJoin(snapshots, eq(snapshots.id, teamDiscussions.snapshotId))
        .where(eq(teamDiscussions.projectId, projectId))
        .orderBy(asc(teamDiscussions.pushedAt), asc(teamDiscussions.authorId)),
      db.select().from(teamProgress).where(eq(teamProgress.projectId, projectId)).orderBy(desc(teamProgress.pushedAt)),
    ]);

  // 成员：同一个人有多行（移除后又加回）时，未移除的优先，其次取最近的一行
  const memberByUser = new Map<string, (typeof memberRows)[number]>();
  for (const m of memberRows) {
    const cur = memberByUser.get(m.userId);
    if (!cur || (cur.removedAt !== null && (m.removedAt === null || m.addedAt >= cur.addedAt))) memberByUser.set(m.userId, m);
  }
  const activeMemberIds = new Set([...memberByUser.values()].filter((m) => m.removedAt === null).map((m) => m.userId));

  const myMerged = baseRev === null ? [] : myRows.filter((m) => m.status === "merged" && (m.mergedRev ?? 0) > baseRev);
  const userIds = [
    row.ownerId,
    me.userId,
    ...lineRows.map((l) => l.updatedBy),
    ...historyRows.map((h) => h.byUserId),
    ...memberByUser.keys(),
    ...sealingRows.map((s) => s.userId),
    ...[...openRows, ...myRows].flatMap((m) => [m.authorId, m.decidedBy]),
    ...discussionRows.map((d) => d.authorId),
    ...progressRows.map((p) => p.userId),
  ];
  const refs = await loadUserRefs(projectId, row.ownerId, userIds);

  const lines: TeamLineHead[] = lineRows.map((l) => ({
    line: "main",
    rev: l.rev,
    headSnapshotId: l.headSnapshotId,
    baseVersionKey: l.baseVersionKey ?? null,
    updatedAt: iso(l.updatedAt),
    updatedBy: userRef(refs, l.updatedBy ?? row.ownerId),
  }));
  const history: LineHistoryEntry[] = historyRows.map((h) => ({
    line: "main",
    rev: h.rev,
    reason: h.reason,
    snapshotId: h.snapshotId,
    mrId: h.mrId ?? null,
    versionKey: h.versionKey ?? null,
    by: userRef(refs, h.byUserId ?? row.ownerId),
    at: iso(h.at),
  }));

  const records = query.appliedStateRev === st.stateRev ? null : await loadTeamRecords(projectId, row.ownerId, st);
  const start = await loadStart(projectId, st.startTeamSnapshotId);

  const sealing: SealingEntry[] = sealingRows.map((s) => ({
    line: s.line as SealingEntry["line"],
    user: userRef(refs, s.userId),
    deviceId: s.deviceId,
    since: iso(s.since),
    seenAt: iso(s.seenAt),
  }));

  // 每位未移除成员最近推送的一份（progressRows 已按推送时间从新到旧）
  const seenProgress = new Set<string>();
  const progress: TeamState["progress"] = [];
  for (const p of progressRows) {
    if (!activeMemberIds.has(p.userId) && p.userId !== row.ownerId) continue;
    if (seenProgress.has(p.userId)) continue;
    seenProgress.add(p.userId);
    const summary = (p.summary ?? {}) as { items?: string[]; total?: number };
    progress.push({
      user: userRef(refs, p.userId),
      deviceId: p.deviceId,
      line: p.line as TeamState["progress"][number]["line"],
      baseRev: p.baseRev > 0 ? p.baseRev : null,
      changed: { items: summary.items ?? [], total: summary.total ?? 0 },
      pushedAt: iso(p.pushedAt),
    });
  }

  const myMergedSinceBase: MyMergedMr[] = myMerged
    .sort((a, b) => (a.mergedRev ?? 0) - (b.mergedRev ?? 0))
    .map((m) => ({
      id: m.id,
      seq: m.seq,
      baseRev: m.baseRev,
      mergedRev: m.mergedRev!,
      snapshotId: m.snapshotId,
      renumberMap: (m.renumberMap ?? null) as MyMergedMr["renumberMap"],
    }));

  return {
    project: { id: projectId, name: row.name },
    me: { user: userRef(refs, me.userId), role: me.role },
    teamSince: iso(teamSince),
    teamReadyAt: iso(teamReadyAt),
    minClientFormat: minClientFormatOf(st.teamClientFormat),
    stateRev: st.stateRev,
    lines,
    history,
    records,
    start,
    ids: parseStoredLedger(st.idLedger),
    sealing,
    openMrs: openRows.map((m) => toMrSummary(m, refs)),
    myMrs: myRows.slice(0, TEAM_LIMITS.myMrsMax).map((m) => toMrSummary(m, refs)),
    myMergedSinceBase,
    members: [...memberByUser.values()].map((m) => ({
      user: { ...userRef(refs, m.userId), removed: m.removedAt !== null },
      role: m.role,
      addedAt: iso(m.addedAt),
      removedAt: isoOrNull(m.removedAt),
    })),
    progress,
    discussions: discussionRows.map((d) => ({
      author: userRef(refs, d.authorId),
      snapshotId: d.snapshotId,
      contentDigest: d.contentDigest,
      pushedAt: iso(d.pushedAt),
    })),
  };
}

async function loadStart(projectId: string, startSnapshotId: string | null): Promise<TeamStart | null> {
  if (!startSnapshotId) return null;
  const rows = await db
    .select({ key: repoVersions.key, commitRaw: repoVersions.commitRawB64 })
    .from(repoVersions)
    .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.teamSnapshotId, startSnapshotId)))
    .limit(1);
  const r = rows[0];
  if (!r || !r.commitRaw) return null;
  return { key: r.key, commitRaw: r.commitRaw, snapshotId: startSnapshotId };
}

/** 版本记录、上线标记、访客草稿。 */
async function loadTeamRecords(
  projectId: string,
  ownerId: string,
  st: typeof repoState.$inferSelect,
): Promise<TeamRecords> {
  const [versionRows, sealEvents, draftRows] = await Promise.all([
    db
      .select()
      .from(repoVersions)
      .where(
        and(
          eq(repoVersions.projectId, projectId),
          isNotNull(repoVersions.teamSnapshotId),
          isNotNull(repoVersions.teamRecord),
          isNotNull(repoVersions.commitRawB64),
          inArray(repoVersions.kind, ["version", "baseline"]),
        ),
      )
      .orderBy(asc(repoVersions.createdAt), asc(repoVersions.id)),
    db
      .select({ actorId: teamEvents.actorId, payload: teamEvents.payload })
      .from(teamEvents)
      .where(and(eq(teamEvents.projectId, projectId), eq(teamEvents.type, TEAM_EVENT_VERSION_SEALED))),
    db
      .select({
        key: repoVersions.key,
        line: repoVersions.line,
        parentKey: repoVersions.parentKey,
        teamRecord: repoVersions.teamRecord,
        updatedAt: repoVersions.updatedAt,
        contentDigest: snapshots.contentSha256,
      })
      .from(repoVersions)
      .innerJoin(snapshots, eq(snapshots.id, repoVersions.snapshotId))
      .where(
        and(eq(repoVersions.projectId, projectId), eq(repoVersions.kind, "draft"), isNull(repoVersions.withdrawnAt)),
      )
      .orderBy(desc(repoVersions.updatedAt)),
  ]);

  const sealerOf = new Map<string, string>();
  for (const e of sealEvents) {
    const key = (e.payload as { key?: unknown } | null)?.key;
    if (typeof key === "string" && e.actorId) sealerOf.set(key, e.actorId);
  }
  const refs = await loadUserRefs(projectId, ownerId, [...sealerOf.values()]);

  const periods = Array.isArray(st.onlinePeriods)
    ? (st.onlinePeriods as unknown[]).filter((p) => checkShape(OnlinePeriod, p).length === 0)
    : [];
  const online = { key: st.onlineKey ?? null, periods } as Online;

  // 访客草稿：团队流程写的草稿在 team_record 里记着来自团队主线的哪个 rev；没有 rev 的是团队开启前的旧草稿
  let guestDraft: TeamRecords["guestDraft"] = null;
  for (const d of draftRows) {
    const rev = (d.teamRecord as { rev?: unknown } | null)?.rev;
    if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 1 || d.line !== "main") continue;
    guestDraft = {
      key: d.key,
      line: "main",
      rev,
      basedOn: d.parentKey ?? null,
      contentDigest: d.contentDigest,
      pushedAt: iso(d.updatedAt),
    };
    break;
  }

  return {
    versions: versionRows.map((v) => ({
      key: v.key,
      record: v.teamRecord as TeamRecords["versions"][number]["record"],
      commitRaw: v.commitRawB64!,
      teamSnapshotId: v.teamSnapshotId!,
      sealer: sealerOf.has(v.key) ? userRef(refs, sealerOf.get(v.key)) : null,
      pushedAt: iso(v.updatedAt),
    })),
    online,
    guestDraft,
  };
}

export type RefreshInput = {
  appliedStateRev: number | null;
  ids: IdLedgerType;
  progress: {
    deviceId: string;
    line: string;
    baseRev: number | null;
    changed: { items: string[]; total: number };
  };
};

/** 一次往返：并入编号账、存这台设备在这条线上的进度摘要，再返回团队状态。 */
export async function refreshTeam(
  projectId: string,
  me: { userId: string; role: TeamRole },
  input: RefreshInput,
): Promise<TeamState> {
  await db.transaction(async (tx) => {
    const state = await lockRepoState(tx, projectId);
    if (!state) throw new TeamError("not_found");
    if (!state.teamReadyAt) throw new TeamError("team_not_ready", "先在 G-canvas 里开启团队协作");
    await tx
      .update(repoState)
      .set({ idLedger: mergeLedgers(parseStoredLedger(state.idLedger), input.ids) })
      .where(eq(repoState.projectId, projectId));
    await upsertProgress(tx, projectId, me.userId, input.progress);
  });
  return loadTeamState(projectId, me, {
    appliedStateRev: input.appliedStateRev,
    line: input.progress.line,
    baseRev: input.progress.baseRev,
  });
}

async function upsertProgress(tx: Tx, projectId: string, userId: string, p: RefreshInput["progress"]) {
  const now = new Date();
  // 补丁线没有团队主线，基准 rev 记 0
  const values = {
    projectId,
    userId,
    deviceId: p.deviceId,
    line: p.line,
    baseRev: p.baseRev ?? 0,
    summary: { items: p.changed.items, total: p.changed.total },
    pushedAt: now,
  };
  await tx
    .insert(teamProgress)
    .values(values)
    .onDuplicateKeyUpdate({ set: { baseRev: values.baseRev, summary: values.summary, pushedAt: now } });
}

// ---------------------------------------------------------------------------
// 接口 5、6：文件表与按指纹下载
// ---------------------------------------------------------------------------

/**
 * 本项目的一份快照的文件表：团队方案下的，或内置方案下的访客快照。别的项目的快照号 → not_found。
 * 调用方已确认调用者是成员。
 */
export async function loadProjectSnapshotFiles(
  projectId: string,
  snapshotId: string,
): Promise<{ snapshotId: string; audience: "guest" | "team"; files: TeamListedFile[] }> {
  const rows = await db
    .select({ id: snapshots.id, audience: snapshots.audience })
    .from(snapshots)
    .innerJoin(versions, eq(versions.id, snapshots.versionId))
    .where(and(eq(snapshots.id, snapshotId), eq(versions.projectId, projectId)))
    .limit(1);
  const snap = rows[0];
  if (!snap) throw new TeamError("not_found");
  const files = await loadSnapshotFiles(snapshotId);
  return {
    snapshotId,
    audience: snap.audience,
    files: files.map((f) => ({
      path: f.path,
      sha256: f.sha256,
      size: f.size,
      gitMode: (f.gitMode as TeamListedFile["gitMode"]) ?? null,
      gitOid: f.gitOid ?? null,
    })),
  };
}

/** 本项目登记过的指纹：返回对象存储键与大小；没登记过 → not_found。 */
export async function findProjectBlob(
  projectId: string,
  sha256: string,
): Promise<{ s3Key: string; sizeBytes: number }> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TeamError("not_found");
  const rows = await db
    .select({ sizeBytes: repoBlobs.sizeBytes })
    .from(repoBlobs)
    .where(and(eq(repoBlobs.projectId, projectId), eq(repoBlobs.sha256, sha256)))
    .limit(1);
  if (!rows[0]) throw new TeamError("not_found");
  return { s3Key: blobS3Key(projectId, sha256), sizeBytes: rows[0].sizeBytes };
}

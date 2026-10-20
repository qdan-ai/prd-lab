import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  projectMembers,
  repoState,
  repoVersions,
  snapshots,
  teamEvents,
  teamLineHistory,
  teamLines,
  versions,
} from "../db/schema";
import { checkRepoPath, REPO_LIMITS } from "./manifest";
import type {
  InitDoneRequest,
  InitDoneResponse,
  InitRequest,
  InitResponse,
  InitStatusResponse,
  TeamFiles,
  TeamVersionRecord,
} from "./team-contract";
import { TeamError, validationError } from "./team-errors";
import { noteClientFormat } from "./team-format";
import { teamGates } from "./team-gate";
import type { RepoProject } from "./project";
import { loadUserRefs, userRef } from "./team-read";
import {
  insertTeamSnapshot,
  loadBlobInfo,
  loadSnapshotFiles,
  lockRepoState,
  type Tx,
} from "./team-snapshot";

/** 团队方案在项目里的名字（方案名在项目内唯一）。 */
export const TEAM_VERSION_NAME = "团队方案";

const START_KIND = "hidden" as const;

// ---------------------------------------------------------------------------
// 校验（事务外）
// ---------------------------------------------------------------------------

/** 提交原文按 git 规则算出的提交号：`sha1("commit <字节数>\0" + 原文)`。 */
export function commitOidOf(commitRawBase64: string): string {
  const raw = Buffer.from(commitRawBase64, "base64");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`commit ${raw.length}\0`), raw])).digest("hex");
}

/** 提交原文算出的号必须等于 key。 */
export function assertCommitMatches(key: string, commitRaw: string): void {
  const actual = commitOidOf(commitRaw);
  if (actual !== key) throw validationError("commit_mismatch", { key, expected: key, actual });
}

/** 团队文件表里的路径：结构合法即可（版本树里可以有讨论目录下的文件）。 */
function assertTeamPath(path: string, key: string | undefined): void {
  const err = checkRepoPath(path);
  if (err && err.code !== "discussions_not_allowed") {
    throw validationError("invalid_path", { ...(key ? { key } : {}), path });
  }
}

type FileTable = { key?: string; files: TeamFiles };

/**
 * 核对一批团队文件表：路径合法 → 文件都已登记且有对象号（否则 `blobs_missing`）→ 每个文件的
 * `gitOid` 等于上传时算好的对象号（否则 `git_oid_mismatch`）→ 单版大小不超上限。
 * 返回指纹 → 大小，供建快照用。
 */
export async function verifyTeamFileTables(projectId: string, tables: FileTable[]): Promise<Map<string, number>> {
  for (const t of tables) for (const path of Object.keys(t.files)) assertTeamPath(path, t.key);
  const shas = tables.flatMap((t) => Object.values(t.files).map((f) => f.sha256));
  const info = await loadBlobInfo(projectId, shas);
  const missing = [...new Set(shas)].filter((s) => !info.get(s)?.gitOid);
  if (missing.length > 0) throw new TeamError("blobs_missing", `${missing.length} file(s) not uploaded yet`, { missing });
  for (const t of tables) {
    let total = 0;
    for (const [path, f] of Object.entries(t.files)) {
      const blob = info.get(f.sha256)!;
      if (blob.gitOid !== f.gitOid) {
        throw validationError("git_oid_mismatch", {
          ...(t.key ? { key: t.key } : {}),
          path,
          expected: blob.gitOid,
          actual: f.gitOid,
        });
      }
      total += blob.sizeBytes;
    }
    if (total > REPO_LIMITS.maxBytesPerVersion) {
      throw validationError("version_too_large", {
        ...(t.key ? { key: t.key } : {}),
        fileCount: Object.keys(t.files).length,
        totalBytes: total,
        maxBytes: REPO_LIMITS.maxBytesPerVersion,
      });
    }
  }
  return new Map([...info].map(([sha, b]) => [sha, b.sizeBytes]));
}

function toSnapshotFiles(files: TeamFiles) {
  return Object.entries(files).map(([path, f]) => ({ path, sha256: f.sha256, gitMode: f.gitMode, gitOid: f.gitOid }));
}

async function sameTeamFiles(snapshotId: string, files: TeamFiles, conn: Tx): Promise<boolean> {
  const stored = await loadSnapshotFiles(snapshotId, conn);
  if (stored.length !== Object.keys(files).length) return false;
  return stored.every((s) => {
    const f = files[s.path];
    return !!f && f.sha256 === s.sha256 && f.gitMode === s.gitMode && f.gitOid === s.gitOid;
  });
}

// ---------------------------------------------------------------------------
// 接口 17：分批开启
// ---------------------------------------------------------------------------

function ensureOwner(repo: RepoProject, userId: string): void {
  if (repo.ownerId !== userId) throw new TeamError("not_owner");
}

/**
 * 收一批开启数据。第一次调用（不带 `initId`）建团队方案、置 `team_since`、把负责人记为成员，此后项目算团队项目；
 * 之后每批带上 `initId`（= 团队方案的 id）。按版本 key 收：已收过的同一版本、文件表相同就跳过，同 key 文件表不同 →
 * `version_conflict`；所以同一批重发得到同样的响应。`start` `head` `ids` 各传一次即可，后传的覆盖先传的。
 */
export async function receiveInitBatch(
  repo: RepoProject,
  userId: string,
  req: InitRequest,
  clientFormat: number,
): Promise<InitResponse> {
  ensureOwner(repo, userId);
  const before = await db.select().from(repoState).where(eq(repoState.projectId, repo.id)).limit(1);
  if (before[0]?.teamReadyAt) throw new TeamError("team_already_open", "team_already_open");
  if (req.initId !== undefined && req.initId !== before[0]?.teamVersionId) throw new TeamError("not_found");

  // 纯函数校验在占名额之前：坏请求不占整站的名额
  for (const v of req.versions) {
    assertCommitMatches(v.key, v.commitRaw);
    if (v.record.key !== v.key) throw validationError("record_key_mismatch", { key: v.key });
  }
  if (req.start) assertCommitMatches(req.start.key, req.start.commitRaw);

  const release = teamGates.initBatches.acquireOrThrow();
  try {
    const sizes = await verifyTeamFileTables(repo.id, [
      ...req.versions.map((v) => ({ key: v.key, files: v.files })),
      ...(req.start ? [{ key: req.start.key, files: req.start.files }] : []),
      ...(req.head ? [{ files: req.head.files }] : []),
    ]);
    return await db.transaction(async (tx) => {
      const state = await lockRepoState(tx, repo.id);
      if (!state) throw new TeamError("not_found");
      if (state.teamReadyAt) throw new TeamError("team_already_open", "team_already_open");
      if (req.initId !== undefined && req.initId !== state.teamVersionId) throw new TeamError("not_found");

      let teamVersionId = state.teamVersionId;
      if (!teamVersionId) teamVersionId = await startTeamOpening(tx, repo, userId);
      const ctx = { tx, projectId: repo.id, teamVersionId, userId, sizes };

      const received: string[] = [];
      for (const v of req.versions) {
        await upsertVersion(ctx, v.key, v.commitRaw, v.files, v.record, record2kind(v.record));
        if (!received.includes(v.key)) received.push(v.key);
      }
      if (req.start) await replaceStart(ctx, state.startTeamSnapshotId, req.start);
      if (req.head) await replaceHead(ctx, req.head, userId);
      if (req.ids) await tx.update(repoState).set({ idLedger: req.ids }).where(eq(repoState.projectId, repo.id));
      await noteClientFormat(repo.id, clientFormat, tx);
      return { initId: teamVersionId, batchSeq: req.batchSeq, received };
    });
  } finally {
    release();
  }
}

function record2kind(record: TeamVersionRecord): "version" | "baseline" {
  return record.kind === "baseline" ? "baseline" : "version";
}

/** 第一次调用：建团队方案，置 `team_since`，负责人记为成员。 */
async function startTeamOpening(tx: Tx, repo: RepoProject, userId: string): Promise<string> {
  const maxRows = await tx
    .select({ maxSeq: sql<number | null>`MAX(${versions.seqNo})` })
    .from(versions)
    .where(eq(versions.projectId, repo.id));
  const teamVersionId = randomUUID();
  await tx.insert(versions).values({
    id: teamVersionId,
    projectId: repo.id,
    name: TEAM_VERSION_NAME,
    seqNo: Number(maxRows[0]?.maxSeq ?? 0) + 1,
    createdBy: userId,
  });
  await tx
    .update(repoState)
    .set({ teamVersionId, teamSince: new Date() })
    .where(eq(repoState.projectId, repo.id));
  await tx.insert(projectMembers).values({ projectId: repo.id, userId: repo.ownerId, role: "lead", addedBy: userId });
  await tx.insert(teamEvents).values({ projectId: repo.id, actorId: userId, type: "team_open_started", payload: {} });
  return teamVersionId;
}

type Ctx = {
  tx: Tx;
  projectId: string;
  teamVersionId: string;
  userId: string;
  sizes: Map<string, number>;
};

/**
 * 收一个版本（或开始前的样子）：已有同 key 的行（先前推给访客的）就补上团队列；没有就新建一行，
 * `snapshot_id` 暂指团队快照本身（访客读函数按快照读者范围过滤，看不到）。
 */
async function upsertVersion(
  ctx: Ctx,
  key: string,
  commitRaw: string,
  files: TeamFiles,
  record: TeamVersionRecord | null,
  kind: "version" | "baseline" | typeof START_KIND,
): Promise<string> {
  const { tx, projectId } = ctx;
  const rows = await tx
    .select()
    .from(repoVersions)
    .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.key, key)))
    .limit(1);
  const existing = rows[0];
  if (existing?.teamSnapshotId) {
    if (!(await sameTeamFiles(existing.teamSnapshotId, files, tx))) throw validationError("version_conflict", { key });
    return existing.teamSnapshotId;
  }
  const snapshotId = await insertTeamSnapshot(tx, {
    projectId,
    versionId: ctx.teamVersionId,
    uploaderId: ctx.userId,
    files: toSnapshotFiles(files),
    sizes: ctx.sizes,
    changeNote: kind === START_KIND ? "团队开启：开始前的样子" : `团队开启：${record?.number ?? key.slice(0, 12)}`,
  });
  const now = new Date();
  const teamColumns = { teamSnapshotId: snapshotId, commitRawB64: commitRaw, teamRecord: record as object | null };
  if (existing) {
    await tx
      .update(repoVersions)
      .set({ ...teamColumns, updatedAt: now })
      .where(eq(repoVersions.id, existing.id));
  } else {
    await tx.insert(repoVersions).values({
      projectId,
      key,
      snapshotId,
      kind,
      ...(record
        ? {
            number: record.number,
            name: record.name,
            summary: record.summary,
            line: record.line,
            parentKey: record.parentKey,
            patchOf: record.patchOf,
            sealedAt: new Date(record.sealedAt),
            changes: record.changes as object,
            specDocs: record.specDocs,
          }
        : {}),
      ...teamColumns,
      createdAt: now,
      updatedAt: now,
    });
  }
  return snapshotId;
}

/** 去掉一行的团队部分（行是为团队新建的就整行删），并删掉它的团队快照。 */
async function dropTeamPart(tx: Tx, projectId: string, teamSnapshotId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(repoVersions)
    .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.teamSnapshotId, teamSnapshotId)));
  for (const row of rows) {
    if (row.snapshotId === teamSnapshotId) {
      await tx.delete(repoVersions).where(eq(repoVersions.id, row.id));
    } else {
      await tx
        .update(repoVersions)
        .set({ teamSnapshotId: null, commitRawB64: null, teamRecord: null })
        .where(eq(repoVersions.id, row.id));
    }
  }
  await tx.delete(snapshots).where(eq(snapshots.id, teamSnapshotId));
}

async function replaceStart(ctx: Ctx, prevSnapshotId: string | null, start: NonNullable<InitRequest["start"]>) {
  const { tx, projectId } = ctx;
  if (prevSnapshotId) {
    const prev = await tx
      .select({ key: repoVersions.key })
      .from(repoVersions)
      .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.teamSnapshotId, prevSnapshotId)))
      .limit(1);
    if (prev[0]?.key === start.key && (await sameTeamFiles(prevSnapshotId, start.files, tx))) return;
    await tx.update(repoState).set({ startTeamSnapshotId: null }).where(eq(repoState.projectId, projectId));
    await dropTeamPart(tx, projectId, prevSnapshotId);
  }
  const snapshotId = await upsertVersion(ctx, start.key, start.commitRaw, start.files, null, START_KIND);
  await tx.update(repoState).set({ startTeamSnapshotId: snapshotId }).where(eq(repoState.projectId, projectId));
}

async function replaceHead(ctx: Ctx, head: NonNullable<InitRequest["head"]>, userId: string) {
  const { tx, projectId } = ctx;
  const prev = await tx
    .select()
    .from(teamLines)
    .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, "main")))
    .limit(1);
  const snapshotId = await insertTeamSnapshot(tx, {
    projectId,
    versionId: ctx.teamVersionId,
    uploaderId: userId,
    files: toSnapshotFiles(head.files),
    sizes: ctx.sizes,
    changeNote: "团队开启：团队主线初值",
  });
  const now = new Date();
  if (prev[0]) {
    await tx
      .update(teamLines)
      .set({ headSnapshotId: snapshotId, baseVersionKey: head.baseVersionKey, updatedBy: userId, updatedAt: now })
      .where(and(eq(teamLines.projectId, projectId), eq(teamLines.line, "main")));
    await tx.delete(snapshots).where(eq(snapshots.id, prev[0].headSnapshotId));
  } else {
    await tx.insert(teamLines).values({
      projectId,
      line: "main",
      rev: 1,
      headSnapshotId: snapshotId,
      baseVersionKey: head.baseVersionKey,
      updatedBy: userId,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// 接口 17：查进度、完成
// ---------------------------------------------------------------------------

/** 已收下的版本 key（不含开始前的样子），按收下先后。 */
async function receivedVersionKeys(projectId: string, conn: Tx | typeof db = db): Promise<string[]> {
  const rows = await conn
    .select({ key: repoVersions.key })
    .from(repoVersions)
    .where(
      and(
        eq(repoVersions.projectId, projectId),
        isNotNull(repoVersions.teamSnapshotId),
        inArray(repoVersions.kind, ["version", "baseline"]),
      ),
    )
    .orderBy(asc(repoVersions.updatedAt), asc(repoVersions.id));
  return rows.map((r) => r.key);
}

/** 断线续传：这次开启已收到什么。`initId` 不是这个项目现在的开启 → not_found。 */
export async function getInitStatus(repo: RepoProject, userId: string, initId: string): Promise<InitStatusResponse> {
  ensureOwner(repo, userId);
  const rows = await db.select().from(repoState).where(eq(repoState.projectId, repo.id)).limit(1);
  const st = rows[0];
  if (!st?.teamVersionId || st.teamVersionId !== initId) throw new TeamError("not_found");
  const line = await db
    .select({ projectId: teamLines.projectId })
    .from(teamLines)
    .where(and(eq(teamLines.projectId, repo.id), eq(teamLines.line, "main")))
    .limit(1);
  return {
    initId,
    receivedVersionKeys: await receivedVersionKeys(repo.id),
    hasStart: st.startTeamSnapshotId !== null,
    hasHead: line.length > 0,
    hasIds: st.idLedger !== null,
    ready: st.teamReadyAt !== null,
  };
}

/**
 * 完成开启：核对声明的版本都已收下、没有多收、父版本都在、团队主线初值与编号账已收；都齐才置 `team_ready_at`、
 * 建团队主线 rev 1（reason = init），状态号为 0。
 */
export async function completeInit(
  repo: RepoProject,
  userId: string,
  req: InitDoneRequest,
): Promise<InitDoneResponse> {
  ensureOwner(repo, userId);
  return db.transaction(async (tx) => {
    const state = await lockRepoState(tx, repo.id);
    if (!state?.teamVersionId || state.teamVersionId !== req.initId) throw new TeamError("not_found");
    if (state.teamReadyAt) throw new TeamError("team_already_open", "team_already_open");

    const received = await receivedVersionKeys(repo.id, tx);
    const declared = new Set(req.versionKeys);
    const receivedSet = new Set(received);
    const missingVersions = [...declared].filter((k) => !receivedSet.has(k));
    const extraVersions = received.filter((k) => !declared.has(k));

    const records = await tx
      .select({ key: repoVersions.key, record: repoVersions.teamRecord })
      .from(repoVersions)
      .where(
        and(
          eq(repoVersions.projectId, repo.id),
          isNotNull(repoVersions.teamSnapshotId),
          inArray(repoVersions.kind, ["version", "baseline"]),
        ),
      );
    const startKey = state.startTeamSnapshotId
      ? (
          await tx
            .select({ key: repoVersions.key })
            .from(repoVersions)
            .where(and(eq(repoVersions.projectId, repo.id), eq(repoVersions.teamSnapshotId, state.startTeamSnapshotId)))
            .limit(1)
        )[0]?.key
      : undefined;
    const known = new Set([...receivedSet, ...(startKey ? [startKey] : [])]);
    const dangling = new Set<string>();
    for (const r of records) {
      const rec = r.record as { parentKey?: string | null; patchOf?: string | null } | null;
      for (const parent of [rec?.parentKey, rec?.patchOf]) if (parent && !known.has(parent)) dangling.add(parent);
    }

    const lineRows = await tx
      .select()
      .from(teamLines)
      .where(and(eq(teamLines.projectId, repo.id), eq(teamLines.line, "main")))
      .limit(1);
    const headLine = lineRows[0];
    const missingHead = !headLine;
    const missingIds = state.idLedger === null;
    if (missingVersions.length + extraVersions.length + dangling.size > 0 || missingHead || missingIds) {
      throw new TeamError("init_incomplete", "init_incomplete", {
        missingVersions,
        extraVersions,
        danglingParents: [...dangling].sort(),
        missingHead,
        missingIds,
      });
    }

    const now = new Date();
    await tx
      .update(repoState)
      .set({ teamReadyAt: now, stateRev: 0 })
      .where(eq(repoState.projectId, repo.id));
    await tx
      .update(teamLines)
      .set({ rev: 1, updatedBy: userId, updatedAt: now })
      .where(and(eq(teamLines.projectId, repo.id), eq(teamLines.line, "main")));
    await tx.insert(teamLineHistory).values({
      projectId: repo.id,
      line: "main",
      rev: 1,
      snapshotId: headLine!.headSnapshotId,
      reason: "init",
      mrId: null,
      versionKey: null,
      byUserId: userId,
      at: now,
    });
    await tx.insert(teamEvents).values({
      projectId: repo.id,
      actorId: userId,
      type: "team_opened",
      payload: { versions: received.length },
    });
    const refs = await loadUserRefs(repo.id, repo.ownerId, [userId], tx);
    return {
      teamReadyAt: now.toISOString(),
      line: {
        line: "main",
        rev: 1,
        headSnapshotId: headLine!.headSnapshotId,
        baseVersionKey: headLine!.baseVersionKey ?? null,
        updatedAt: now.toISOString(),
        updatedBy: userRef(refs, userId),
      },
      stateRev: 0,
    };
  });
}

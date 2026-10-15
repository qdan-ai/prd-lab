import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { repoState, repoVersions, snapshotFiles, snapshots, users } from "../db/schema";
import { REPO_FORMAT } from "./manifest";
import { type RepoProject, getRepoShare } from "./project";
import { defaultVersionKey, type ResolveInput, type ResolvableVersion } from "./resolve";

type VersionRow = {
  key: string;
  kind: "version" | "baseline" | "draft" | "hidden";
  number: string | null;
  name: string | null;
  summary: string | null;
  line: string | null;
  parentKey: string | null;
  patchOf: string | null;
  sealedAt: Date | null;
  changes: unknown;
  specDocs: unknown;
  withdrawnAt: Date | null;
  createdAt: Date;
  contentDigest: string;
};

async function loadVersionRows(projectId: string): Promise<VersionRow[]> {
  return db
    .select({
      key: repoVersions.key,
      kind: repoVersions.kind,
      number: repoVersions.number,
      name: repoVersions.name,
      summary: repoVersions.summary,
      line: repoVersions.line,
      parentKey: repoVersions.parentKey,
      patchOf: repoVersions.patchOf,
      sealedAt: repoVersions.sealedAt,
      changes: repoVersions.changes,
      specDocs: repoVersions.specDocs,
      withdrawnAt: repoVersions.withdrawnAt,
      createdAt: repoVersions.createdAt,
      contentDigest: snapshots.contentSha256,
    })
    .from(repoVersions)
    .innerJoin(snapshots, eq(repoVersions.snapshotId, snapshots.id))
    .where(eq(repoVersions.projectId, projectId))
    .orderBy(asc(repoVersions.createdAt), asc(repoVersions.key));
}

async function loadStateRow(projectId: string) {
  const rows = await db
    .select({
      onlineKey: repoState.onlineKey,
      onlinePeriods: repoState.onlinePeriods,
      lastPushedAt: repoState.lastPushedAt,
      lastPushedBy: users.name,
    })
    .from(repoState)
    .leftJoin(users, eq(repoState.lastPushedBy, users.id))
    .where(eq(repoState.projectId, projectId))
    .limit(1);
  return rows[0] ?? { onlineKey: null, onlinePeriods: null, lastPushedAt: null, lastPushedBy: null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function versionView(r: VersionRow) {
  return {
    key: r.key,
    kind: r.kind as "version" | "baseline",
    number: r.number,
    name: r.name,
    summary: r.summary,
    line: r.line,
    parentKey: r.parentKey,
    patchOf: r.patchOf,
    sealedAt: iso(r.sealedAt),
    changes: r.changes ?? null,
    specDocs: (r.specDocs as string[] | null) ?? null,
    contentDigest: r.contentDigest,
    pushedAt: r.createdAt.toISOString(),
  };
}

function toResolveInput(rows: VersionRow[], onlineKey: string | null): ResolveInput {
  const versions: ResolvableVersion[] = rows
    .filter((r) => r.kind === "version" || r.kind === "baseline")
    .map((r) => ({
      key: r.key,
      kind: r.kind as "version" | "baseline",
      number: r.number,
      line: r.line,
      sealedAt: r.sealedAt,
      createdAt: r.createdAt,
      withdrawn: r.withdrawnAt !== null,
    }));
  const draft = rows.find((r) => r.kind === "draft" && r.withdrawnAt === null);
  return { versions, draft: draft ? { key: draft.key } : null, onlineKey };
}

/**
 * 推送方看的远端现状（GET /api/v1/repos/:pid/state）：含已撤回的版本（带 withdrawn 标记），
 * 本机据此知道哪些版本服务端已有内容、重推不必带文件。
 */
export async function getRepoPushState(repo: RepoProject) {
  const [rows, state, share] = await Promise.all([
    loadVersionRows(repo.id),
    loadStateRow(repo.id),
    getRepoShare(repo.versionId),
  ]);
  const draft = rows.find((r) => r.kind === "draft" && r.withdrawnAt === null);
  return {
    format: REPO_FORMAT,
    project: { id: repo.id, name: repo.name },
    versions: rows
      .filter((r) => r.kind === "version" || r.kind === "baseline")
      .map((r) => ({ ...versionView(r), withdrawn: r.withdrawnAt !== null })),
    draft: draft
      ? {
          key: draft.key,
          line: draft.line,
          basedOn: draft.parentKey,
          contentDigest: draft.contentDigest,
          pushedAt: draft.createdAt.toISOString(),
        }
      : null,
    hidden: rows.filter((r) => r.kind === "hidden").map((r) => ({ key: r.key, contentDigest: r.contentDigest })),
    online: { key: state.onlineKey, periods: state.onlinePeriods ?? null },
    pushedAt: iso(state.lastPushedAt),
    pushedBy: state.lastPushedBy,
    share,
  };
}

/**
 * 查看器读的版本图（预览站 /r/<pid>/repo.json，对应 RepoReader.getRepo）：只含未撤回的。
 * 另返回 resolveInput，供调用方按 ?v= 解析落到哪一版。
 */
export async function getRepoView(repo: RepoProject) {
  const [rows, state] = await Promise.all([loadVersionRows(repo.id), loadStateRow(repo.id)]);
  const live = rows.filter((r) => r.withdrawnAt === null);
  const resolveInput = toResolveInput(rows, state.onlineKey);
  const visibleKeys = new Set(
    live.filter((r) => r.kind === "version" || r.kind === "baseline").map((r) => r.key),
  );
  const draft = live.find((r) => r.kind === "draft");
  const view = {
    format: REPO_FORMAT,
    project: { id: repo.id, name: repo.name },
    versions: live.filter((r) => r.kind === "version" || r.kind === "baseline").map(versionView),
    draft: draft
      ? { key: draft.key, line: draft.line, basedOn: draft.parentKey, pushedAt: draft.createdAt.toISOString() }
      : null,
    hidden: live.filter((r) => r.kind === "hidden").map((r) => ({ key: r.key })),
    online: {
      key: state.onlineKey && visibleKeys.has(state.onlineKey) ? state.onlineKey : null,
      periods: state.onlinePeriods ?? null,
    },
    pushedAt: iso(state.lastPushedAt),
    defaultVersionKey: defaultVersionKey(resolveInput),
  };
  return { view, resolveInput };
}

export type RepoKeyLookup =
  | { status: "ok"; snapshotId: string }
  | { status: "withdrawn" }
  | { status: "not_found" };

/** key → 快照（同时校验它属于这个仓库、未撤回）。 */
export async function lookupRepoKey(projectId: string, key: string): Promise<RepoKeyLookup> {
  const rows = await db
    .select({ snapshotId: repoVersions.snapshotId, withdrawnAt: repoVersions.withdrawnAt })
    .from(repoVersions)
    .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.key, key)))
    .limit(1);
  const row = rows[0];
  if (!row) return { status: "not_found" };
  if (row.withdrawnAt !== null) return { status: "withdrawn" };
  return { status: "ok", snapshotId: row.snapshotId };
}

/** RepoReader.listFiles：某版本的文件清单（路径升序）。 */
export async function listSnapshotFiles(snapshotId: string) {
  const rows = await db
    .select({
      path: snapshotFiles.relPath,
      size: snapshotFiles.sizeBytes,
      sha256: snapshotFiles.sha256,
      contentType: snapshotFiles.contentType,
    })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, snapshotId));
  return rows.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

/** RepoReader.readText / fileUrl：某版本某路径的文件位置。 */
export async function findSnapshotFile(snapshotId: string, path: string) {
  const rows = await db
    .select({ s3Key: snapshotFiles.s3Key, contentType: snapshotFiles.contentType })
    .from(snapshotFiles)
    .where(and(eq(snapshotFiles.snapshotId, snapshotId), eq(snapshotFiles.relPath, path)))
    .limit(1);
  return rows[0] ?? null;
}

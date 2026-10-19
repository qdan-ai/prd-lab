import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { repoState, repoVersions, snapshotFiles, snapshots, users } from "../db/schema";
import { buildAgentPrompt, type AgentPrompt } from "./agent";
import { REPO_FORMAT } from "./manifest";
import { type RepoProject, getRepoShare } from "./project";
import { defaultVersionKey, resolveRepoVersion, type ResolveInput, type ResolvableVersion } from "./resolve";

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
    // 按封版时间升序（草稿、起点没有封版时间，排最前）；同一次推送写入的行 created_at 相同，最后按 key 保证顺序稳定
    .orderBy(asc(repoVersions.sealedAt), asc(repoVersions.createdAt), asc(repoVersions.key));
}

async function loadStateRow(projectId: string) {
  const rows = await db
    .select({
      onlineKey: repoState.onlineKey,
      onlinePeriods: repoState.onlinePeriods,
      summary: repoState.summary,
      lastPushedAt: repoState.lastPushedAt,
      lastPushedBy: users.name,
    })
    .from(repoState)
    .leftJoin(users, eq(repoState.lastPushedBy, users.id))
    .where(eq(repoState.projectId, projectId))
    .limit(1);
  return rows[0] ?? { onlineKey: null, onlinePeriods: null, summary: null, lastPushedAt: null, lastPushedBy: null };
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
    project: { id: repo.id, name: repo.name, summary: state.summary },
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
    project: { id: repo.id, name: repo.name, summary: state.summary },
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

export type AgentVersion = {
  key: string;
  kind: "version" | "baseline" | "draft";
  number: string | null;
  name: string | null;
  summary: string | null;
  line: string | null;
  parentKey: string | null;
  patchOf: string | null;
  sealedAt: string | null;
  specDocs: string[] | null;
  manifest: unknown;
  snapshotId: string;
};

export type AgentVersionLookup =
  | { status: "ok"; version: AgentVersion }
  | { status: "withdrawn"; number: string | null; replacement: { key: string; number: string | null } | null }
  | { status: "not_found" };

/**
 * 给 AI 取用的版本查找：同时限定项目与 key。起点 / 版本 / 草稿可取；hidden 视同不存在；
 * 已撤回给「已撤回」与同版本号下封版最新的未撤回版本（替代版本），永不静默回落。
 */
export async function lookupAgentVersion(projectId: string, key: string): Promise<AgentVersionLookup> {
  const rows = await db
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
      specDocs: repoVersions.specDocs,
      manifest: repoVersions.manifest,
      snapshotId: repoVersions.snapshotId,
      withdrawnAt: repoVersions.withdrawnAt,
    })
    .from(repoVersions)
    .where(and(eq(repoVersions.projectId, projectId), eq(repoVersions.key, key)))
    .limit(1);
  const r = rows[0];
  if (!r || r.kind === "hidden") return { status: "not_found" };
  if (r.withdrawnAt !== null) {
    let replacement: { key: string; number: string | null } | null = null;
    if (r.number !== null) {
      const all = await loadVersionRows(projectId);
      const resolved = resolveRepoVersion(toResolveInput(all, null), r.number);
      const hit = resolved.notice === null ? all.find((v) => v.key === resolved.key) : undefined;
      if (hit && hit.key !== r.key && hit.kind !== "draft") replacement = { key: hit.key, number: hit.number };
    }
    return { status: "withdrawn", number: r.number, replacement };
  }
  return {
    status: "ok",
    version: {
      key: r.key,
      kind: r.kind as AgentVersion["kind"],
      number: r.number,
      name: r.name,
      summary: r.summary,
      line: r.line,
      parentKey: r.parentKey,
      patchOf: r.patchOf,
      sealedAt: iso(r.sealedAt),
      specDocs: (r.specDocs as string[] | null) ?? null,
      manifest: r.manifest ?? null,
      snapshotId: r.snapshotId,
    },
  };
}

/** 某版本全部文件的对象存储位置（路径 → s3Key），打包按它逐个读。不对外暴露 s3Key。 */
export async function listSnapshotFileLocations(snapshotId: string) {
  return db
    .select({ path: snapshotFiles.relPath, s3Key: snapshotFiles.s3Key })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, snapshotId));
}

export type AgentPromptResult =
  | { status: "no_share" }
  | { status: "version_not_found" }
  | { status: "version_withdrawn"; replacement: { key: string; number: string | null } | null }
  | {
      status: "ok";
      projectName: string;
      shareId: string;
      hasPassword: boolean;
      passwordVersion: number;
      version: { key: string; number: string | null; name: string | null } | null;
      prompt: AgentPrompt;
    };

/**
 * 「复制给 AI」的提示词：G-canvas（个人令牌）与查看器（仓库会话）两个入口共用，说法不会分叉。
 * 没有访客链接 → no_share；`key` 为 null = 不锁版本。密码占位 `{{PASSWORD}}` 留给调用方在本机或浏览器里填。
 */
export async function buildRepoAgentPrompt(
  repo: RepoProject,
  origin: string,
  key: string | null,
): Promise<AgentPromptResult> {
  const share = await getRepoShare(repo.versionId);
  if (!share) return { status: "no_share" };
  let version: { key: string; number: string | null; name: string | null } | null = null;
  if (key !== null) {
    const found = await lookupAgentVersion(repo.id, key);
    if (found.status === "not_found") return { status: "version_not_found" };
    if (found.status === "withdrawn") return { status: "version_withdrawn", replacement: found.replacement };
    version = { key: found.version.key, number: found.version.number, name: found.version.name };
  }
  return {
    status: "ok",
    projectName: repo.name,
    shareId: share.shareId,
    hasPassword: share.hasPassword,
    passwordVersion: share.passwordVersion,
    version,
    prompt: buildAgentPrompt({
      projectName: repo.name,
      origin,
      shareId: share.shareId,
      version,
      hasPassword: share.hasPassword,
    }),
  };
}

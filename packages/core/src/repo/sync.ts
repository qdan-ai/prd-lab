import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { repoBlobs, repoState, repoVersions, snapshotFiles, snapshots, versions } from "../db/schema";
import { getObjectBuffer, uploadFile } from "../s3";
import { RENDERERS } from "../renderers/registry";
import { sniffContentType, type ZipFile } from "../zip-utils";
import { blobS3Key, contentDigest, draftKey } from "./digest";
import {
  REPO_FORMAT,
  REPO_LIMITS,
  checkChangeManifest,
  isValidSha256,
  type ManifestFile,
  type ManifestVersion,
  type SyncManifest,
} from "./manifest";
import { RepoError, type RepoProject } from "./project";
import { loadBlobInfo } from "./team-snapshot";

const IN_CHUNK = 1000;

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 已登记文件的指纹 → 实测大小（项目内）。 */
async function blobSizes(projectId: string, shas: string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  for (const part of chunks([...new Set(shas)], IN_CHUNK)) {
    const rows = await db
      .select({ sha256: repoBlobs.sha256, sizeBytes: repoBlobs.sizeBytes })
      .from(repoBlobs)
      .where(and(eq(repoBlobs.projectId, projectId), inArray(repoBlobs.sha256, part)));
    for (const r of rows) found.set(r.sha256, r.sizeBytes);
  }
  return found;
}

/**
 * 本项目里还没登记的指纹（保持请求顺序、去重）。
 * `requireGitOid`：已登记但还没有 git 对象号的也算缺（团队流程用，重传一次即补上对象号）。
 */
export async function findMissingBlobs(
  projectId: string,
  shas: string[],
  opts: { requireGitOid?: boolean } = {},
): Promise<string[]> {
  const bad = shas.filter((s) => !isValidSha256(s));
  if (bad.length > 0) {
    throw new RepoError("validation_error", "sha256 must be 64 lowercase hex", { invalid: bad.slice(0, 20) });
  }
  const found = await loadBlobInfo(projectId, shas);
  return [...new Set(shas)].filter((s) => {
    const row = found.get(s);
    return !row || (opts.requireGitOid === true && row.gitOid === null);
  });
}

/** git 对象号：`sha1("blob <字节数>\0" + 字节)`。 */
export function gitBlobOid(bytes: Buffer): string {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), bytes])).digest("hex");
}

/**
 * 登记一个文件：校验大小与指纹 → 写 MinIO → 登记 repo_blobs（连同 git 对象号）。
 * 已登记的直接返回 existed=true（还没有对象号的这次补上）；中断在写对象与登记之间只会留下未登记对象，下次重传覆盖。
 */
export async function putBlob(
  projectId: string,
  sha256: string,
  bytes: Buffer,
): Promise<{ existed: boolean; sizeBytes: number; gitOid: string }> {
  if (!isValidSha256(sha256)) throw new RepoError("validation_error", "sha256 must be 64 lowercase hex");
  if (bytes.byteLength > REPO_LIMITS.maxFileBytes) {
    throw new RepoError("validation_error", "file_too_large", {
      size: bytes.byteLength,
      max: REPO_LIMITS.maxFileBytes,
    });
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new RepoError("validation_error", "digest_mismatch", { expected: sha256, actual });
  }
  const gitOid = gitBlobOid(bytes);
  const existing = (await loadBlobInfo(projectId, [sha256])).get(sha256);
  if (existing) {
    if (existing.gitOid === null) {
      await db
        .update(repoBlobs)
        .set({ gitOid })
        .where(and(eq(repoBlobs.projectId, projectId), eq(repoBlobs.sha256, sha256), isNull(repoBlobs.gitOid)));
    }
    return { existed: true, sizeBytes: bytes.byteLength, gitOid };
  }
  await uploadFile(blobS3Key(projectId, sha256), bytes, "application/octet-stream");
  await db
    .insert(repoBlobs)
    .values({ projectId, sha256, sizeBytes: bytes.byteLength, gitOid })
    .onDuplicateKeyUpdate({ set: { gitOid: sql`COALESCE(${repoBlobs.gitOid}, ${gitOid})` } });
  return { existed: false, sizeBytes: bytes.byteLength, gitOid };
}

/** 一个需要新建快照的条目（新版本 / 新起点 / 新草稿），事务外准备好全部内容。 */
type PreparedEntry = {
  key: string;
  role: "version" | "hidden" | "draft";
  files: ManifestFile[];
  sizes: Map<string, number>;
  digest: string;
  rendererName: string | null;
  rendererMetadata: Record<string, unknown> | null;
  meta: ManifestVersion | null;
  draft: { line: string | null; basedOn: string | null } | null;
  /** 校验通过、要随新版本存下的机器清单；null = 没带或不符 */
  manifest: unknown;
  /** 带了机器清单但不符（只丢清单，版本照常落库） */
  manifestRejected: boolean;
};

export type SyncResult = {
  pushedAt: Date;
  draftKey: string | null;
  created: string[];
  updated: string[];
  withdrawn: string[];
  /** 带了机器清单但校验不符、清单被丢掉的版本 key（版本本身照常落库） */
  manifestRejected: string[];
};

/**
 * 一次推送：事务外校验与准备（文件是否都已上传、上限、canvas.json 格式），
 * 事务内按 key 落库。同一项目的推送用 repo_state 行锁串行化；全部按 key 幂等，重复提交无副作用。
 * 设计见 ai/specs/2026-10-15-repo-push-design.md §3.3。
 */
export async function syncRepo(repo: RepoProject, userId: string, manifest: SyncManifest): Promise<SyncResult> {
  const existingBefore = await loadKeys(repo.id);

  // ---- 事务外：确定要新建的条目并校验 ----
  const pending: Array<Omit<PreparedEntry, "sizes" | "rendererName" | "rendererMetadata">> = [];
  const noManifest = { manifest: null, manifestRejected: false };
  for (const v of manifest.versions) {
    if (existingBefore.has(v.key)) continue;
    if (!v.files) throw new RepoError("validation_error", "files_required", { key: v.key });
    const digest = contentDigest(v.files);
    const rejected = v.manifest !== null && checkChangeManifest(v.manifest, v.key, digest) !== null;
    pending.push({
      key: v.key,
      role: "version",
      files: v.files,
      digest,
      meta: v,
      draft: null,
      manifest: rejected ? null : v.manifest,
      manifestRejected: rejected,
    });
  }
  for (const h of manifest.hidden) {
    if (existingBefore.has(h.key)) continue;
    if (!h.files) throw new RepoError("validation_error", "files_required", { key: h.key });
    pending.push({
      key: h.key,
      role: "hidden",
      files: h.files,
      digest: contentDigest(h.files),
      meta: null,
      draft: null,
      ...noManifest,
    });
  }
  let wantedDraftKey: string | null = null;
  if (manifest.draft) {
    const digest = contentDigest(manifest.draft.files);
    wantedDraftKey = draftKey(manifest.draft.line, manifest.draft.basedOn, digest);
    if (!existingBefore.has(wantedDraftKey)) {
      pending.push({
        key: wantedDraftKey,
        role: "draft",
        files: manifest.draft.files,
        digest,
        meta: null,
        draft: { line: manifest.draft.line, basedOn: manifest.draft.basedOn },
        ...noManifest,
      });
    }
  }

  const allShas = pending.flatMap((p) => p.files.map((f) => f.sha256));
  const sizes = await blobSizes(repo.id, allShas);
  const missing = [...new Set(allShas)].filter((s) => !sizes.has(s));
  if (missing.length > 0) {
    throw new RepoError("blobs_missing", `${missing.length} file(s) not uploaded yet`, { missing });
  }

  const canvasCache = new Map<string, Buffer>();
  const prepared: PreparedEntry[] = [];
  for (const p of pending) {
    const total = p.files.reduce((s, f) => s + (sizes.get(f.sha256) ?? 0), 0);
    if (p.files.length > REPO_LIMITS.maxFilesPerVersion || total > REPO_LIMITS.maxBytesPerVersion) {
      throw new RepoError("validation_error", "version_too_large", {
        key: p.key,
        fileCount: p.files.length,
        totalBytes: total,
        maxFiles: REPO_LIMITS.maxFilesPerVersion,
        maxBytes: REPO_LIMITS.maxBytesPerVersion,
      });
    }
    const renderer = await checkRenderer(repo.id, p, sizes, canvasCache);
    prepared.push({ ...p, sizes, ...renderer });
  }

  // ---- 事务内：落库 ----
  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT project_id FROM ${repoState} WHERE project_id = ${repo.id} FOR UPDATE`,
    );
    if (rowCount(locked) === 0) throw new RepoError("not_repo");
    await tx.execute(sql`SELECT id FROM ${versions} WHERE id = ${repo.versionId} FOR UPDATE`);

    const now = new Date();
    const existing = await loadKeys(repo.id, tx);
    const maxSeqRows = await tx
      .select({ maxSeq: sql<number | null>`MAX(${snapshots.seqNo})` })
      .from(snapshots)
      .where(eq(snapshots.versionId, repo.versionId));
    let seq = Number(maxSeqRows[0]?.maxSeq ?? 0);

    const created: string[] = [];
    const updated: string[] = [];
    const manifestRejected: string[] = [];

    const insertEntry = async (p: PreparedEntry) => {
      const snapshotId = randomUUID();
      seq += 1;
      const label =
        p.role === "draft" ? "草稿" : p.role === "hidden" ? "起点" : (p.meta?.number ?? p.key.slice(0, 12));
      await tx.insert(snapshots).values({
        id: snapshotId,
        versionId: repo.versionId,
        seqNo: seq,
        entryHtmlPath: "index.html",
        rendererName: p.rendererName,
        rendererMetadata: p.rendererMetadata,
        totalSizeBytes: p.files.reduce((s, f) => s + (p.sizes.get(f.sha256) ?? 0), 0),
        fileCount: p.files.length,
        contentSha256: p.digest,
        uploaderId: userId,
        uploaderType: "user",
        changeNote: `G-canvas 推送 ${label}`,
        versionLabel: null,
      });
      for (const part of chunks(p.files, 500)) {
        await tx.insert(snapshotFiles).values(
          part.map((f) => ({
            snapshotId,
            relPath: f.path,
            s3Key: blobS3Key(repo.id, f.sha256),
            contentType: sniffContentType(f.path),
            sizeBytes: p.sizes.get(f.sha256) ?? 0,
            sha256: f.sha256,
          })),
        );
      }
      await tx.insert(repoVersions).values({
        projectId: repo.id,
        key: p.key,
        snapshotId,
        kind: p.role === "version" ? (p.meta?.kind ?? "version") : p.role,
        ...(p.meta ? versionMetaColumns(p.meta) : {}),
        ...(p.draft ? { line: p.draft.line, parentKey: p.draft.basedOn } : {}),
        manifest: p.manifest as object | null,
        createdAt: now,
        updatedAt: now,
      });
      created.push(p.key);
      if (p.manifestRejected) manifestRejected.push(p.key);
    };
    const preparedByKey = new Map(prepared.map((p) => [p.key, p]));

    // 版本：已有的只改元数据（撤回过的恢复；机器清单只在还没有时写），新的建快照
    for (const v of manifest.versions) {
      const row = existing.get(v.key);
      if (row) {
        let manifestColumn = {};
        if (v.manifest !== null && !row.hasManifest) {
          if (checkChangeManifest(v.manifest, v.key, row.contentDigest) === null) {
            manifestColumn = { manifest: v.manifest as object };
          } else {
            manifestRejected.push(v.key);
          }
        }
        await tx
          .update(repoVersions)
          .set({ ...versionMetaColumns(v), ...manifestColumn, kind: v.kind, withdrawnAt: null, updatedAt: now })
          .where(and(eq(repoVersions.projectId, repo.id), eq(repoVersions.key, v.key)));
        updated.push(v.key);
      } else {
        await insertEntry(mustPrepared(preparedByKey, v.key));
      }
    }

    // 起点：只追加
    for (const h of manifest.hidden) {
      if (!existing.has(h.key)) await insertEntry(mustPrepared(preparedByKey, h.key));
    }

    // 撤回：只撤列出的、存在的、未撤的版本 / 基线
    let withdrawn: string[] = [];
    if (manifest.withdraw.length > 0) {
      withdrawn = manifest.withdraw.filter((k) => {
        const e = existing.get(k);
        return e && e.withdrawnAt === null && (e.kind === "version" || e.kind === "baseline");
      });
      if (withdrawn.length > 0) {
        await tx
          .update(repoVersions)
          .set({ withdrawnAt: now, updatedAt: now })
          .where(and(eq(repoVersions.projectId, repo.id), inArray(repoVersions.key, withdrawn)));
      }
    }

    // 草稿：最多一个未撤回的；与本次相同则不动，否则撤下旧的、放上新的（或恢复同内容的旧草稿）
    const staleDrafts = [...existing.entries()]
      .filter(([k, e]) => e.kind === "draft" && e.withdrawnAt === null && k !== wantedDraftKey)
      .map(([k]) => k);
    if (staleDrafts.length > 0) {
      await tx
        .update(repoVersions)
        .set({ withdrawnAt: now, updatedAt: now })
        .where(and(eq(repoVersions.projectId, repo.id), inArray(repoVersions.key, staleDrafts)));
    }
    if (wantedDraftKey) {
      if (existing.has(wantedDraftKey)) {
        if (existing.get(wantedDraftKey)!.withdrawnAt !== null) {
          await tx
            .update(repoVersions)
            .set({ withdrawnAt: null, updatedAt: now })
            .where(and(eq(repoVersions.projectId, repo.id), eq(repoVersions.key, wantedDraftKey)));
        }
      } else {
        await insertEntry(mustPrepared(preparedByKey, wantedDraftKey));
      }
    }

    await tx
      .update(repoState)
      .set({
        format: REPO_FORMAT,
        lastPushedAt: now,
        lastPushedBy: userId,
        ...(manifest.online
          ? { onlineKey: manifest.online.key, onlinePeriods: manifest.online.periods as object | null }
          : {}),
        ...(manifest.summary !== undefined ? { summary: manifest.summary } : {}),
      })
      .where(eq(repoState.projectId, repo.id));

    return { pushedAt: now, draftKey: wantedDraftKey, created, updated, withdrawn, manifestRejected };
  });
}

function versionMetaColumns(v: ManifestVersion) {
  return {
    number: v.number,
    name: v.name,
    summary: v.summary,
    line: v.line,
    parentKey: v.parentKey,
    patchOf: v.patchOf,
    sealedAt: v.sealedAt,
    changes: v.changes as object | null,
    specDocs: v.specDocs,
  };
}

function mustPrepared(map: Map<string, PreparedEntry>, key: string): PreparedEntry {
  const p = map.get(key);
  // 事务外未准备、事务内又不存在：说明这一版在两次读之间被删掉，只可能是并发异常，让整个请求失败重试
  if (!p) throw new Error(`repo sync: entry ${key} was not prepared`);
  return p;
}

type ExistingRow = {
  kind: "version" | "baseline" | "draft" | "hidden";
  withdrawnAt: Date | null;
  hasManifest: boolean;
  /** 已存快照的内容指纹：已有版本补带的机器清单按它校验 */
  contentDigest: string;
};

async function loadKeys(
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any = db,
): Promise<Map<string, ExistingRow>> {
  const rows: Array<{ key: string; hasManifest: number | string } & Omit<ExistingRow, "hasManifest">> = await conn
    .select({
      key: repoVersions.key,
      kind: repoVersions.kind,
      withdrawnAt: repoVersions.withdrawnAt,
      hasManifest: sql<number>`${repoVersions.manifest} IS NOT NULL`,
      contentDigest: snapshots.contentSha256,
    })
    .from(repoVersions)
    .innerJoin(snapshots, eq(repoVersions.snapshotId, snapshots.id))
    .where(eq(repoVersions.projectId, projectId));
  return new Map(
    rows.map((r) => [
      r.key,
      { kind: r.kind, withdrawnAt: r.withdrawnAt, hasManifest: Number(r.hasManifest) === 1, contentDigest: r.contentDigest },
    ]),
  );
}

function rowCount(result: unknown): number {
  // drizzle mysql2 的 execute 返回 [rows, fields]
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * 版本与草稿须是 html-canvas 能打开的画板（canvas.json 且 format=board/v1 或 board/v2）；
 * 起点不强制，能通过就同样标 html-canvas。
 */
async function checkRenderer(
  projectId: string,
  p: Omit<PreparedEntry, "sizes" | "rendererName" | "rendererMetadata">,
  sizes: Map<string, number>,
  canvasCache: Map<string, Buffer>,
): Promise<{ rendererName: string | null; rendererMetadata: Record<string, unknown> | null }> {
  const spec = RENDERERS["html-canvas"]!;
  const canvas = p.files.find((f) => f.path === "canvas.json");
  let canvasBuf: Buffer | null = null;
  if (canvas) {
    canvasBuf = canvasCache.get(canvas.sha256) ?? null;
    if (!canvasBuf) {
      canvasBuf = await getObjectBuffer(blobS3Key(projectId, canvas.sha256));
      canvasCache.set(canvas.sha256, canvasBuf);
    }
  }
  const files: ZipFile[] = p.files.map((f) => ({
    relPath: f.path,
    contentType: sniffContentType(f.path),
    sizeBytes: sizes.get(f.sha256) ?? 0,
    sha256: f.sha256,
    buffer: f === canvas && canvasBuf ? canvasBuf : Buffer.alloc(0),
  }));
  const err = spec.validateFiles(files);
  if (err !== null) {
    if (p.role === "hidden") return { rendererName: null, rendererMetadata: null };
    throw new RepoError("validation_error", "renderer_requirements_unmet", { key: p.key, reason: err });
  }
  return {
    rendererName: spec.name,
    rendererMetadata: { schemaVersion: spec.configVersion, __computed: spec.computeMetadata(files) },
  };
}


import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { repoBlobs, repoState, snapshotFiles, snapshots } from "../db/schema";
import { sniffContentType } from "../zip-utils";
import { blobS3Key, contentDigest } from "./digest";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Conn = Tx | typeof db;

export type TeamSnapshotFile = {
  path: string;
  sha256: string;
  gitMode?: string | null;
  gitOid?: string | null;
};

const IN_CHUNK = 1000;

export function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 路径按 UTF-8 字节升序。 */
export function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** 本项目已登记文件的指纹 → { 大小, git 对象号 }。 */
export async function loadBlobInfo(
  projectId: string,
  shas: string[],
  conn: Conn = db,
): Promise<Map<string, { sizeBytes: number; gitOid: string | null }>> {
  const found = new Map<string, { sizeBytes: number; gitOid: string | null }>();
  for (const part of chunks([...new Set(shas)], IN_CHUNK)) {
    const rows = await conn
      .select({ sha256: repoBlobs.sha256, sizeBytes: repoBlobs.sizeBytes, gitOid: repoBlobs.gitOid })
      .from(repoBlobs)
      .where(and(eq(repoBlobs.projectId, projectId), inArray(repoBlobs.sha256, part)));
    for (const r of rows) found.set(r.sha256, { sizeBytes: r.sizeBytes, gitOid: r.gitOid });
  }
  return found;
}

/** 锁住项目的 repo_state 行（同一项目的团队写入据此串行）并读出它。 */
export async function lockRepoState(tx: Tx, projectId: string) {
  const rows = await tx.select().from(repoState).where(eq(repoState.projectId, projectId)).for("update");
  return rows[0] ?? null;
}

/**
 * 在团队方案下建一份快照（audience = team）并写入文件表，返回快照号。
 * 调用方在持有 repo_state 行锁的事务里调用（序号取方案内最大值加一）。
 * 文件大小以已登记的文件为准；调用方已确认全部指纹都已登记。
 */
export async function insertTeamSnapshot(
  tx: Tx,
  input: {
    projectId: string;
    versionId: string;
    uploaderId: string;
    files: TeamSnapshotFile[];
    sizes: Map<string, number>;
    changeNote: string;
  },
): Promise<string> {
  const id = randomUUID();
  const maxRows = await tx
    .select({ maxSeq: sql<number | null>`MAX(${snapshots.seqNo})` })
    .from(snapshots)
    .where(eq(snapshots.versionId, input.versionId));
  const seq = Number(maxRows[0]?.maxSeq ?? 0) + 1;
  await tx.insert(snapshots).values({
    id,
    versionId: input.versionId,
    seqNo: seq,
    totalSizeBytes: input.files.reduce((s, f) => s + (input.sizes.get(f.sha256) ?? 0), 0),
    fileCount: input.files.length,
    contentSha256: contentDigest(input.files),
    uploaderId: input.uploaderId,
    uploaderType: "user",
    changeNote: input.changeNote,
    audience: "team",
  });
  for (const part of chunks(input.files, 500)) {
    await tx.insert(snapshotFiles).values(
      part.map((f) => ({
        snapshotId: id,
        relPath: f.path,
        s3Key: blobS3Key(input.projectId, f.sha256),
        contentType: sniffContentType(f.path),
        sizeBytes: input.sizes.get(f.sha256) ?? 0,
        sha256: f.sha256,
        gitMode: f.gitMode ?? null,
        gitOid: f.gitOid ?? null,
      })),
    );
  }
  return id;
}

/** 一份快照的文件表（路径 → 文件），路径按 UTF-8 字节升序。 */
export async function loadSnapshotFiles(snapshotId: string, conn: Conn = db) {
  const rows = await conn
    .select({
      path: snapshotFiles.relPath,
      sha256: snapshotFiles.sha256,
      size: snapshotFiles.sizeBytes,
      gitMode: snapshotFiles.gitMode,
      gitOid: snapshotFiles.gitOid,
    })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, snapshotId));
  return rows.sort((a, b) => compareBytes(a.path, b.path));
}

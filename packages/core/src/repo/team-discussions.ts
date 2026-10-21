import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { snapshots, teamDiscussions, teamEvents } from "../db/schema";
import { contentDigest } from "./digest";
import { checkRepoPath, DISCUSSIONS_PREFIX } from "./manifest";
import type { DiscussionAuthor, DiscussionsPutResponse, PlainFiles } from "./team-contract";
import { TeamError } from "./team-errors";
import { noteClientFormat } from "./team-format";
import type { RepoProject } from "./project";
import { loadUserRefs, userRef } from "./team-read";
import { insertTeamSnapshot, loadBlobInfo } from "./team-snapshot";
import { lockTeamWrite } from "./team-write";

type Rejected = DiscussionsPutResponse["rejected"][number];

/** 个人讨论文件：`docs/discussions/` 下直接放的 `.md`（单层）。 */
export function isDiscussionPath(path: string): boolean {
  if (!path.startsWith(DISCUSSIONS_PREFIX)) return false;
  const name = path.slice(DISCUSSIONS_PREFIX.length);
  if (name.length === 0 || name.includes("/") || !name.endsWith(".md") || name === ".md") return false;
  return checkRepoPath(path)?.code !== "validation_error";
}

/**
 * 整份替换我的讨论文件表（讨论通道），按推送者存：谁推的记在谁名下，别人推不进我的那份。
 * 只核路径：必须是 `docs/discussions/` 下单层的 `.md`，不合的文件拒收（`not_discussion_path`），其余照收。作者号由收方核。
 * 收下的那部分的内容指纹与我现存那份相同 → 不建新快照（`unchanged`，不看 `baseSnapshotId`）。
 * 现存那份的快照号就是版本号：现存那份存在而 `baseSnapshotId` 不是它（含没带）→ `discussions_moved`（带现存号），
 * 推送方先把现存那份合进来再推。文件本体须已上传，缺的 → `blobs_missing`。
 */
export async function putDiscussions(
  repo: RepoProject,
  userId: string,
  files: PlainFiles,
  clientFormat: number,
  baseSnapshotId?: string,
): Promise<DiscussionsPutResponse> {
  const rejected: Rejected[] = [];
  const candidates: Array<[string, { sha256: string; size: number }]> = [];
  for (const [path, f] of Object.entries(files)) {
    if (isDiscussionPath(path)) candidates.push([path, f]);
    else rejected.push({ path, reason: "not_discussion_path" });
  }

  const info = await loadBlobInfo(repo.id, candidates.map(([, f]) => f.sha256));
  const missing = [...new Set(candidates.map(([, f]) => f.sha256))].filter((s) => !info.has(s));
  if (missing.length > 0) throw new TeamError("blobs_missing", `${missing.length} file(s) not uploaded yet`, { missing });

  const accepted = candidates.map(([path, f]) => ({ path, sha256: f.sha256 }));
  accepted.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const digest = contentDigest(accepted);

  return db.transaction(async (tx) => {
    const { state } = await lockTeamWrite(tx, repo.id, userId, "member");
    const previous = await tx
      .select({ snapshotId: teamDiscussions.snapshotId, digest: snapshots.contentSha256 })
      .from(teamDiscussions)
      .innerJoin(snapshots, eq(snapshots.id, teamDiscussions.snapshotId))
      .where(and(eq(teamDiscussions.projectId, repo.id), eq(teamDiscussions.authorId, userId)))
      .limit(1);
    const acceptedPaths = accepted.map((a) => a.path);
    if (previous[0] && previous[0].digest === digest) {
      return { snapshotId: previous[0].snapshotId, unchanged: true, accepted: acceptedPaths, rejected };
    }
    if (previous[0] && previous[0].snapshotId !== baseSnapshotId) {
      throw new TeamError("discussions_moved", "discussions moved", { snapshotId: previous[0].snapshotId });
    }
    const snapshotId = await insertTeamSnapshot(tx, {
      projectId: repo.id,
      versionId: state.teamVersionId,
      uploaderId: userId,
      files: accepted,
      sizes: new Map([...info].map(([sha, b]) => [sha, b.sizeBytes])),
      changeNote: "个人讨论",
    });
    const now = new Date();
    await tx
      .insert(teamDiscussions)
      .values({ projectId: repo.id, authorId: userId, snapshotId, pushedAt: now })
      .onDuplicateKeyUpdate({ set: { snapshotId, pushedAt: now } });
    await noteClientFormat(repo.id, clientFormat, tx);
    await tx.insert(teamEvents).values({
      projectId: repo.id,
      actorId: userId,
      type: "discussions_pushed",
      payload: { files: acceptedPaths.length },
    });
    return { snapshotId, unchanged: false, accepted: acceptedPaths, rejected };
  });
}

/** 各作者最新一份讨论（含已移除成员写的）。 */
export async function listDiscussions(repo: RepoProject): Promise<DiscussionAuthor[]> {
  const rows = await db
    .select({
      authorId: teamDiscussions.authorId,
      snapshotId: teamDiscussions.snapshotId,
      pushedAt: teamDiscussions.pushedAt,
      contentDigest: snapshots.contentSha256,
    })
    .from(teamDiscussions)
    .innerJoin(snapshots, eq(snapshots.id, teamDiscussions.snapshotId))
    .where(eq(teamDiscussions.projectId, repo.id))
    .orderBy(asc(teamDiscussions.pushedAt), asc(teamDiscussions.authorId));
  const refs = await loadUserRefs(
    repo.id,
    repo.ownerId,
    rows.map((r) => r.authorId),
  );
  return rows.map((r) => ({
    author: userRef(refs, r.authorId),
    snapshotId: r.snapshotId,
    contentDigest: r.contentDigest,
    pushedAt: r.pushedAt.toISOString(),
  }));
}

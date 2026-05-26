import { PassThrough } from "node:stream";
// archiver v8 类型滞后，运行时是 ZipArchive class
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as archiverMod from "archiver";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ZipArchive = (archiverMod as any).ZipArchive as new (
  opts?: { zlib?: { level?: number } },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => any;
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  getObjectBuffer,
  projects,
  snapshotFiles,
  snapshots,
  users,
  versions,
} from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ versionId: string }> };

/**
 * GET /api/v1/exports/:versionId
 *
 * S9 简化：纯文件 zip 打包（取最新活跃 snapshot），无评论合并 / SDK 剥离 / vendor 兜底。
 * 附 meta.json 含 archived_snapshots[] 元数据 + README.md 简短说明。
 */
export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { versionId } = await params;

  const rows = await db
    .select({
      versionName: versions.name,
      projectName: projects.name,
      ownerId: projects.ownerId,
    })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(eq(versions.id, versionId), isNull(versions.archivedAt), isNull(projects.archivedAt)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  if (row.ownerId !== session.userId) return errorResponse("not_owner");

  const snapRows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.versionId, versionId), isNull(snapshots.archivedAt)))
    .orderBy(desc(snapshots.seqNo))
    .limit(1);
  const snap = snapRows[0];
  if (!snap) return errorResponse("validation_error", "no active snapshot");
  const exportSnapshotId = snap.id;
  const entryHtmlPath = snap.entryHtmlPath || "index.html";

  const files = await db
    .select({ relPath: snapshotFiles.relPath, s3Key: snapshotFiles.s3Key })
    .from(snapshotFiles)
    .where(eq(snapshotFiles.snapshotId, exportSnapshotId));

  const archivedSnapRows = await db
    .select({
      seqNo: snapshots.seqNo,
      changeNote: snapshots.changeNote,
      archivedAt: snapshots.archivedAt,
      archivedByName: users.name,
    })
    .from(snapshots)
    .leftJoin(users, eq(snapshots.archivedBy, users.id))
    .where(and(eq(snapshots.versionId, versionId), isNotNull(snapshots.archivedAt)))
    .orderBy(asc(snapshots.seqNo));

  const pass = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("error", (err: Error) => pass.destroy(err));
  archive.pipe(pass);

  (async () => {
    try {
      for (const f of files) {
        const buf = await getObjectBuffer(f.s3Key);
        archive.append(buf, { name: f.relPath });
      }

      const exportedAt = new Date().toISOString();
      const meta = {
        project: row.projectName,
        version: row.versionName,
        snapshot: {
          seq: snap.seqNo,
          versionLabel: snap.versionLabel,
          changeNote: snap.changeNote,
          createdAt: snap.createdAt,
          entryHtmlPath,
        },
        exportedAt,
        exportedBy: session.userName,
        archived_snapshots: archivedSnapRows.map((a) => ({
          seq: a.seqNo,
          changeNote: a.changeNote,
          archivedAt: a.archivedAt,
          archivedBy: a.archivedByName,
        })),
      };
      archive.append(Buffer.from(JSON.stringify(meta, null, 2), "utf8"), { name: "meta.json" });

      const readme = [
        `# ${row.projectName} · ${row.versionName} · v${snap.seqNo}`,
        "",
        `导出时间：${exportedAt}`,
        `导出人：${session.userName}`,
        "",
        `入口文件：\`${entryHtmlPath}\``,
        "",
        "## 离线查看",
        "",
        "解压后用浏览器直接打开入口文件即可。",
      ].join("\n");
      archive.append(Buffer.from(readme, "utf8"), { name: "README.md" });

      await archive.finalize();
    } catch (e) {
      pass.destroy(e as Error);
    }
  })();

  const filename = encodeURIComponent(
    `${row.projectName}_${row.versionName}_v${snap.seqNo}_${dateStr()}.zip`,
  );

  // @ts-expect-error toWeb 在 Node 18+ 可用
  const webStream = pass.toWeb
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((pass as any).toWeb() as ReadableStream)
    : new ReadableStream({
        async start(controller) {
          for await (const chunk of pass) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}

function dateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import {
  db,
  idempotencyKeys,
  projects,
  snapshotFiles,
  snapshots,
  uploadFile,
  versions,
  users,
  parseAndValidateZip,
  detectEntryMode,
  parseRendererManifest,
  ZIP_LIMITS,
} from "@prd-lab/core";
import { RENDERERS } from "@prd-lab/core/renderers";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { insertReturning } from "@/lib/db/insert-returning";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ vid: string }> };

/**
 * GET /api/v1/versions/:vid/snapshots
 * 列出活跃快照（按 seq 降序），含 uploader_name + is_current。
 */
export async function GET(_: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

  const versionRows = await db
    .select({
      v: versions,
      visibility: projects.visibility,
      ownerId: projects.ownerId,
    })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(versions.id, vid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const versionRow = versionRows[0];
  if (!versionRow) return errorResponse("not_found");
  const canRead = versionRow.visibility === "team" || versionRow.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");

  const rows = await db
    .select({
      id: snapshots.id,
      seqNo: snapshots.seqNo,
      versionLabel: snapshots.versionLabel,
      changeNote: snapshots.changeNote,
      uploaderName: users.name,
      uploaderType: snapshots.uploaderType,
      createdAt: snapshots.createdAt,
      contentSha256: snapshots.contentSha256,
      entryHtmlPath: snapshots.entryHtmlPath,
      fileCount: snapshots.fileCount,
      totalSizeBytes: snapshots.totalSizeBytes,
    })
    .from(snapshots)
    .innerJoin(users, eq(snapshots.uploaderId, users.id))
    .where(and(eq(snapshots.versionId, vid), isNull(snapshots.archivedAt)))
    .orderBy(desc(snapshots.seqNo));

  return Response.json(rows);
}

/**
 * POST /api/v1/versions/:vid/snapshots
 * 上传 zip 创建新快照。
 * multipart/form-data: file (Blob) + change_note (string) + uploader_type? + version_label? + force_new?
 * 可选 Idempotency-Key header 走 24h 幂等。
 */
export async function POST(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { vid } = await params;

  // 1. owner 校验
  const versionRows = await db
    .select({
      versionId: versions.id,
      projectId: versions.projectId,
      ownerId: projects.ownerId,
    })
    .from(versions)
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(and(eq(versions.id, vid), isNull(versions.archivedAt), isNull(projects.archivedAt)))
    .limit(1);
  const versionRow = versionRows[0];
  if (!versionRow) return errorResponse("not_found");
  if (versionRow.ownerId !== session.userId) return errorResponse("not_owner");

  // 2. Idempotency-Key 24h
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey) {
    const cached = await db
      .select({ responseJson: idempotencyKeys.responseJson, createdAt: idempotencyKeys.createdAt })
      .from(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.key, idempotencyKey), eq(idempotencyKeys.userId, session.userId)),
      )
      .limit(1);
    const hit = cached[0];
    if (hit) {
      const ageMs = Date.now() - new Date(hit.createdAt).getTime();
      if (ageMs < 24 * 3600 * 1000) {
        return Response.json(hit.responseJson);
      }
    }
  }

  // 3. 解析 multipart
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    return errorResponse("validation_error", `invalid multipart: ${(e as Error).message}`);
  }
  const file = formData.get("file");
  const changeNoteRaw = formData.get("change_note");
  const uploaderTypeRaw = formData.get("uploader_type");
  const versionLabelRaw = formData.get("version_label");
  const forceNewRaw = formData.get("force_new");
  if (!(file instanceof Blob)) return errorResponse("validation_error", "missing file");
  if (typeof changeNoteRaw !== "string") return errorResponse("validation_error", "missing change_note");
  const changeNote = changeNoteRaw.trim();
  if (!changeNote || changeNote.length > 2000) {
    return errorResponse("validation_error", "change_note must be 1..2000 chars");
  }
  const uploaderType: "user" | "cli" | "mcp" =
    uploaderTypeRaw === "cli" || uploaderTypeRaw === "mcp"
      ? uploaderTypeRaw
      : "user";
  const versionLabel = typeof versionLabelRaw === "string" ? versionLabelRaw.trim() : "";
  if (versionLabel && versionLabel.length > 64) {
    return errorResponse("validation_error", "version_label must be 1..64 chars");
  }
  const forceNew = forceNewRaw === "true" || forceNewRaw === "1";

  if (file.size > ZIP_LIMITS.maxZipBytes) {
    return errorResponse("validation_error", `zip too large (max ${ZIP_LIMITS.maxZipBytes} bytes)`);
  }

  // 4. zip 解包 + 校验
  const zipBuffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseAndValidateZip(zipBuffer);
  if (!parsed.ok) {
    return errorResponse(
      "validation_error",
      `zip ${parsed.error.code}${"relPath" in parsed.error ? `: ${parsed.error.relPath}` : ""}`,
    );
  }
  const { files, zipSha256 } = parsed.result;
  if (files.length === 0) {
    return errorResponse("validation_error", "zip is empty");
  }

  // 5. 入口探测
  const entryMode = detectEntryMode(files);
  if (entryMode.mode === "multi-html-candidates") {
    return errorResponse(
      "validation_error",
      `multiple root HTML files without index.html: ${entryMode.candidates.join(", ")}`,
    );
  }
  if (entryMode.mode === "no-html-entry") {
    return errorResponse(
      "validation_error",
      "zip 根目录未发现 HTML 入口（请确认 index.html 在 zip 根目录）",
    );
  }

  // 6. renderer manifest 解析（DESIGN §5.2 / preview-renderer-adapter）
  //    - 缺失 / renderer="default" → rendererName=null（行为等同当前）
  //    - 其余 4 类错误（json/schema/unknown/options/requirements）→ 400
  const manifestResult = parseRendererManifest(files);
  if (!manifestResult.ok) {
    const err = manifestResult.error;
    const { code: _omit, ...rest } = err;
    return errorResponse("validation_error", err.code, rest as Record<string, unknown>);
  }
  const manifest = manifestResult.manifest;
  const rendererName = manifest ? manifest.renderer : null;
  let rendererMetadata: Record<string, unknown> | null = null;
  if (rendererName !== null && manifest) {
    const spec = RENDERERS[rendererName]!;
    const userOptions = manifest.rendererOptions ?? {};
    const computed = spec.computeMetadata(files);
    rendererMetadata = {
      schemaVersion: spec.configVersion,
      options: userOptions,
      __computed: computed,
    };
  }

  // S7：version_label 唯一性预检（同方案下活跃 snapshot 占用 → 409）
  if (versionLabel) {
    const labelDup = await db
      .select({ id: snapshots.id, seqNo: snapshots.seqNo })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.versionId, vid),
          eq(snapshots.versionLabel, versionLabel),
          isNull(snapshots.archivedAt),
        ),
      )
      .limit(1);
    if (labelDup[0]) {
      return errorResponse(
        "version_label_conflict",
        `version_label "${versionLabel}" 已被 v${labelDup[0].seqNo} 占用`,
      );
    }
  }

  // 7. 活跃 sha256 撞车分支（S7 改造）
  //    - user 路径 && !force_new → 409 content_duplicate（前端弹二次确认）
  //    - cli / mcp 路径           → 静默返既有（自动化幂等保留）
  //    - force_new=true           → 跳过 dedup，走新建
  const activeDup = await db
    .select({
      id: snapshots.id,
      seqNo: snapshots.seqNo,
      versionLabel: snapshots.versionLabel,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.versionId, vid),
        eq(snapshots.contentSha256, zipSha256),
        isNull(snapshots.archivedAt),
      ),
    )
    .limit(1);
  if (activeDup[0] && !forceNew) {
    if (uploaderType === "user") {
      return Response.json(
        {
          error_code: "content_duplicate",
          message: "zip 内容与既有活跃快照完全一致",
          duplicateOf: {
            snapshotId: activeDup[0].id,
            seqNo: activeDup[0].seqNo,
            versionLabel: activeDup[0].versionLabel,
          },
        },
        { status: 409 },
      );
    }
    // cli / mcp 自动化路径：保留静默幂等语义
    const responseBody = { snapshot: activeDup[0], duplicateOfActive: true };
    if (idempotencyKey) {
      await persistIdempotency(idempotencyKey, session.userId, responseBody);
    }
    return Response.json(responseBody);
  }

  // 8. 归档命中（不复活，新建独立 snapshot；响应携带 matched 元数据）
  const archivedDup = await db
    .select({
      id: snapshots.id,
      seqNo: snapshots.seqNo,
      archivedAt: snapshots.archivedAt,
      archivedBy: snapshots.archivedBy,
    })
    .from(snapshots)
    .where(
      and(eq(snapshots.versionId, vid), eq(snapshots.contentSha256, zipSha256)),
    )
    .limit(1);
  // archivedDup 已活跃 case 上面去了；这里若有则必是归档
  const matchedArchived = archivedDup[0] && archivedDup[0].archivedAt
    ? {
        snapshotId: archivedDup[0].id,
        seqNo: archivedDup[0].seqNo,
        deletedAt: archivedDup[0].archivedAt,
        deletedBy: archivedDup[0].archivedBy,
      }
    : null;

  // 9. 事务：分配 seq_no + insert snapshots + insert snapshot_files
  const insertResult = await db.transaction(async (tx) => {
    // 锁 version 行（防 seq 撞车）
    await tx.execute(drizzleSql`SELECT id FROM ${versions} WHERE id = ${vid} FOR UPDATE`);

    const maxSeqRow = await tx
      .select({ maxSeq: drizzleSql<number | null>`MAX(${snapshots.seqNo})` })
      .from(snapshots)
      .where(eq(snapshots.versionId, vid));
    const nextSeq = (maxSeqRow[0]?.maxSeq ?? 0) + 1;
    const entryHtmlPath = entryMode.entryHtml;

    const snapshotRow = await insertReturning(tx, snapshots, {
      versionId: vid,
      seqNo: nextSeq,
      entryHtmlPath,
      // renderer_name / renderer_metadata 仅在 INSERT 时一次性写入（DESIGN §4.4 / 决策 D12，禁后续 UPDATE）
      rendererName,
      rendererMetadata,
      totalSizeBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
      fileCount: files.length,
      contentSha256: zipSha256,
      uploaderId: session.userId,
      uploaderType,
      changeNote,
      versionLabel: versionLabel || null,
    });

    const fileRows = files.map((f) => ({
      snapshotId: snapshotRow.id,
      relPath: f.relPath,
      s3Key: makeS3Key(versionRow.projectId, snapshotRow.id, f.relPath),
      contentType: f.contentType,
      sizeBytes: f.sizeBytes,
      sha256: f.sha256,
    }));
    await tx.insert(snapshotFiles).values(fileRows);

    return { snapshot: snapshotRow, fileRows };
  });

  // 10. S3 上传（事务外，并行）—— 失败需补偿删 snapshot 行，简化版直接 throw 让 PG 行残留
  // 最佳实践应用 outbox pattern，S2 简化：上传失败软删 snapshot
  try {
    await Promise.all(
      files.map((f, i) =>
        uploadFile(insertResult.fileRows[i]!.s3Key, f.buffer, f.contentType),
      ),
    );
  } catch (e) {
    await db
      .update(snapshots)
      .set({ archivedAt: new Date(), archivedBy: session.userId })
      .where(eq(snapshots.id, insertResult.snapshot.id));
    return errorResponse("validation_error", `S3 upload failed: ${(e as Error).message}`);
  }

  // S8：删除"设为 current"逻辑——snapshot 平行化后不再有 current 概念

  // 11. response + 幂等存档
  const responseBody = {
    snapshot: insertResult.snapshot,
    matchedArchived,
  };
  if (idempotencyKey) {
    await persistIdempotency(idempotencyKey, session.userId, responseBody);
  }
  return Response.json(responseBody);
}

// ---- helpers ----

function makeS3Key(projectId: string, snapshotId: string, relPath: string): string {
  return `projects/${projectId}/snapshots/${snapshotId}/${relPath}`;
}

async function persistIdempotency(key: string, userId: string, body: unknown): Promise<void> {
  // MySQL: 用 INSERT IGNORE 等价于 PG 的 onConflictDoNothing（首次写入即可，命中复合主键则忽略）
  await db
    .insert(idempotencyKeys)
    .values({ key, userId, responseJson: body as object })
    .onDuplicateKeyUpdate({ set: { key: drizzleSql`${idempotencyKeys.key}` } });
}

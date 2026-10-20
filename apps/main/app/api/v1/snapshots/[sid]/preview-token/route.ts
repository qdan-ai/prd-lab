import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  issueToken,
  projects,
  snapshotInAudience,
  snapshots,
  versions,
  PREVIEW_HANDOFF_TTL_SECONDS,
} from "@prd-lab/core";
import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";
import { requestOrigin } from "@/lib/api/request-origin";

/**
 * POST /api/v1/snapshots/:sid/preview-token
 * 签发 300s 查询串交接 token（主站点文件 → window.open 预览站）。
 * S20：payload 带 origin，供预览站会话过期后 302 回 preview-refresh 自动重签。
 */
export async function POST(request: Request, { params }: { params: Promise<{ sid: string }> }) {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  const { sid } = await params;

  // 校验可读
  const rows = await db
    .select({
      visibility: projects.visibility,
      ownerId: projects.ownerId,
      archivedAt: snapshots.archivedAt,
    })
    .from(snapshots)
    .innerJoin(versions, eq(snapshots.versionId, versions.id))
    .innerJoin(projects, eq(versions.projectId, projects.id))
    .where(
      and(
        eq(snapshots.id, sid),
        isNull(versions.archivedAt),
        isNull(projects.archivedAt),
        snapshotInAudience("guest"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return errorResponse("not_found");
  const canRead = row.visibility === "team" || row.ownerId === session.userId;
  if (!canRead) return errorResponse("not_found");
  if (row.archivedAt !== null) return errorResponse("snapshot_archived");

  const token = issueToken(
    { snapshotId: sid, sessionUserId: session.userId, origin: requestOrigin(request) },
    PREVIEW_HANDOFF_TTL_SECONDS,
  );
  return Response.json({ token, expiresIn: PREVIEW_HANDOFF_TTL_SECONDS });
}

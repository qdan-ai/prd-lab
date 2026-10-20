import { Readable } from "node:stream";
import { getObjectStream } from "@prd-lab/core";
import { findProjectBlob, teamGates } from "@prd-lab/core/repo";
import { handleTeamError, teamGuard } from "@/lib/repo/team-route";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ pid: string; sha256: string }> };

/**
 * GET …/team/blobs/:sha256   按指纹下载文件原始字节（流式），只给本项目登记过的指纹。
 * 成员可用，格式头必带，有格式门槛；整站同时下载数满回 429 与 Retry-After。
 */
export async function GET(request: Request, { params }: Ctx) {
  const { pid, sha256 } = await params;
  const guard = await teamGuard(request, pid, { gated: true });
  if (guard instanceof Response) return guard;
  let release: (() => void) | null = null;
  try {
    release = teamGates.downloads.acquireOrThrow();
    const blob = await findProjectBlob(pid, sha256);
    const { stream } = await getObjectStream(blob.s3Key, request.signal);
    const done = release;
    stream.once("close", done);
    release = null;
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(blob.sizeBytes),
      },
    });
  } catch (e) {
    release?.();
    return handleTeamError(e);
  }
}

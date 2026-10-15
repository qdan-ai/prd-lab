import { readFile } from "node:fs/promises";
import { resolveViewerFile } from "../../../lib/gcanvas-viewer";

export const runtime = "nodejs";

/**
 * G-canvas 只读查看器成品包静态资源：/gcanvas-viewer/<版本>/<路径> → vendor/gcanvas-viewer/<版本>/<路径>
 *
 * 与访客页同源，/r/ 外壳的内容安全策略（script-src / style-src / font-src 'self'）才放行。
 * 成品包不含机密与业务数据，任何人凭地址可取；版本目录内容不可变，长缓存。
 * 防护：后缀白名单、逐段字符集、resolve 后必须仍在版本目录内、nosniff。
 */
type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(_: Request, { params }: Ctx) {
  const { path } = await params;
  const found = resolveViewerFile(path ?? []);
  if (!found.ok) return text(found.status, found.message);

  let buffer: Buffer;
  try {
    buffer = await readFile(found.file);
  } catch {
    return text(404, "asset not found");
  }
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  return new Response(ab, {
    status: 200,
    headers: {
      "Content-Type": found.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

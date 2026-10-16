import { createHash } from "node:crypto";

/**
 * 版本内容指纹：sha256( 按路径 UTF-8 字节升序拼接的 "<路径>\0<文件sha256>\n" )，十六进制小写。
 * 同内容同值，写进 snapshots.content_sha256，state 接口原样返回供本机对账。
 */
export function contentDigest(files: ReadonlyArray<{ path: string; sha256: string }>): string {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const h = createHash("sha256");
  for (const f of sorted) h.update(`${f.path}\0${f.sha256}\n`);
  return h.digest("hex");
}

/** 草稿 key 由服务端按「所在线 + 基于哪版 + 内容」派生：同一份草稿重复推送得到同一个 key。 */
export function draftKey(line: string | null, basedOn: string | null, digest: string): string {
  const h = createHash("sha256").update(`${line ?? ""}\0${basedOn ?? ""}\0${digest}`).digest("hex");
  return `draft-${h.slice(0, 40)}`;
}

/** 仓库文件在对象存储里的键：项目内按内容指纹共用。 */
export function blobS3Key(projectId: string, sha256: string): string {
  return `projects/${projectId}/blobs/${sha256}`;
}

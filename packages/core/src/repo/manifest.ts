/**
 * 仓库式推送的清单格式（gcanvas-repo/1）解析与校验。纯函数，不碰数据库与对象存储。
 *
 * 清单由 G-canvas 每次推送整体发来：全部版本的元数据（新版本带文件表与机器清单）、要撤回的 key、
 * 上线标记、可选草稿、首个版本之父「开始前的样子」、项目简介。字段定义见
 * ai/specs/2026-10-15-repo-push-design.md §3.2。
 */

export const REPO_FORMAT = "gcanvas-repo/1";

/**
 * 仓库项目的上限。单个文件与 zip 上传同为 20 MB（上传时整个读进内存算指纹）；
 * 每版的文件数与合计按「整个版本历史一起同步、文件按内容去重」定：一版内容超限就永远推不上去。
 */
export const REPO_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxFilesPerVersion: 2000,
  maxBytesPerVersion: 1024 * 1024 * 1024,
} as const;

/** 项目简介上限（字符），与版本简介一致。 */
export const REPO_SUMMARY_MAX = 20000;

/** 讨论记录目录：只在本机，服务端拒收（本机过滤出错时尽早暴露）。 */
export const DISCUSSIONS_PREFIX = "docs/discussions/";

const KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type ManifestFile = { path: string; sha256: string };

export type ManifestVersion = {
  key: string;
  kind: "version" | "baseline";
  number: string | null;
  name: string | null;
  summary: string | null;
  line: string | null;
  parentKey: string | null;
  patchOf: string | null;
  sealedAt: Date | null;
  changes: unknown;
  specDocs: string[] | null;
  /** null = 未带文件表（服务端已有这一版时可省） */
  files: ManifestFile[] | null;
  /** 机器清单原样（未校验）；null = 没带。校验在落库时做，不符只丢清单，见 checkChangeManifest */
  manifest: unknown;
};

export type ManifestDraft = {
  line: string | null;
  basedOn: string | null;
  files: ManifestFile[];
};

export type ManifestHidden = { key: string; files: ManifestFile[] | null };

export type SyncManifest = {
  versions: ManifestVersion[];
  withdraw: string[];
  /** undefined = 本次不改上线标记 */
  online: { key: string | null; periods: unknown } | undefined;
  /** null = 撤下远端草稿 */
  draft: ManifestDraft | null;
  hidden: ManifestHidden[];
  /** 项目简介：undefined = 本次不改；null = 清空 */
  summary: string | null | undefined;
};

export type ManifestError = {
  code: "validation_error" | "unsupported_format" | "discussions_not_allowed";
  message: string;
  details?: Record<string, unknown>;
};

export type ParseResult = { ok: true; manifest: SyncManifest } | { ok: false; error: ManifestError };

export function isValidKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

export function isValidSha256(s: unknown): s is string {
  return typeof s === "string" && SHA256_RE.test(s);
}

/**
 * 路径里有没有 `..` 段（往上一级）。只认整段：文件名里的连续点号（`方案...md`、`a..b.html`）是合法名字。
 */
export function hasParentSegment(path: string): boolean {
  return path.split("/").includes("..");
}

/**
 * 文件路径校验：非空、≤ 700、没有 `..` 段、无 `\`、不以 `/` 或盘符开头、无控制字符，外加讨论记录目录拒收。
 * 返回 null 表示合法。
 */
export function checkRepoPath(path: string): ManifestError | null {
  if (path.startsWith(DISCUSSIONS_PREFIX)) {
    return {
      code: "discussions_not_allowed",
      message: `讨论记录不能推送：${path}`,
      details: { path },
    };
  }
  if (
    path.length === 0 ||
    path.length > 700 ||
    hasParentSegment(path) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(path)
  ) {
    return { code: "validation_error", message: `invalid path: ${path}`, details: { path } };
  }
  return null;
}

class ParseFail extends Error {
  constructor(readonly error: ManifestError) {
    super(error.message);
  }
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new ParseFail({ code: "validation_error", message, ...(details ? { details } : {}) });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optString(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${field} must be string`);
  if (v.length > max) fail(`${field} too long (max ${max})`);
  return v;
}

function optKey(v: unknown, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (!isValidKey(v)) fail(`${field} is not a valid key`, { [field]: v });
  return v;
}

function optDate(v: unknown, field: string): Date | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${field} must be ISO date string`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(`${field} is not a valid date`, { [field]: v });
  return d;
}

function parseFiles(v: unknown, owner: string): ManifestFile[] {
  if (!isObject(v)) fail(`${owner}.files must be an object of path → { sha256 }`);
  const out: ManifestFile[] = [];
  for (const [path, entry] of Object.entries(v)) {
    const pathErr = checkRepoPath(path);
    if (pathErr) throw new ParseFail(pathErr);
    if (!isObject(entry) || !isValidSha256(entry.sha256)) {
      fail(`${owner}.files["${path}"].sha256 must be 64 lowercase hex`, { path });
    }
    out.push({ path, sha256: entry.sha256 as string });
  }
  return out;
}

function optFiles(v: unknown, owner: string): ManifestFile[] | null {
  if (v === undefined || v === null) return null;
  return parseFiles(v, owner);
}

function parseVersion(v: unknown, i: number): ManifestVersion {
  const at = `versions[${i}]`;
  if (!isObject(v)) fail(`${at} must be an object`);
  if (!isValidKey(v.key)) fail(`${at}.key is not a valid key`, { key: v.key });
  const kind = v.kind ?? "version";
  if (kind !== "version" && kind !== "baseline") fail(`${at}.kind must be version | baseline`);
  let specDocs: string[] | null = null;
  if (v.specDocs !== undefined && v.specDocs !== null) {
    if (!Array.isArray(v.specDocs) || !v.specDocs.every((s) => typeof s === "string")) {
      fail(`${at}.specDocs must be string[]`);
    }
    specDocs = v.specDocs as string[];
  }
  return {
    key: v.key,
    kind,
    number: optString(v.number, `${at}.number`, 64),
    name: optString(v.name, `${at}.name`, 255),
    summary: optString(v.summary, `${at}.summary`, 20000),
    line: optString(v.line, `${at}.line`, 64),
    parentKey: optKey(v.parentKey, `${at}.parentKey`),
    patchOf: optKey(v.patchOf, `${at}.patchOf`),
    sealedAt: optDate(v.sealedAt, `${at}.sealedAt`),
    changes: v.changes === undefined ? null : v.changes,
    specDocs,
    files: optFiles(v.files, at),
    manifest: v.manifest ?? null,
  };
}

function parseKeyList(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`${field} must be an array`);
  return v.map((k) => {
    if (!isValidKey(k)) fail(`${field} contains an invalid key`, { key: k });
    return k;
  });
}

export function parseSyncManifest(body: unknown): ParseResult {
  try {
    if (!isObject(body)) fail("body must be JSON object");
    if (body.format !== REPO_FORMAT) {
      return {
        ok: false,
        error: {
          code: "unsupported_format",
          message: `unsupported format: ${String(body.format)} (expected ${REPO_FORMAT})`,
          details: { expected: REPO_FORMAT, got: body.format ?? null },
        },
      };
    }

    if (body.versions !== undefined && !Array.isArray(body.versions)) fail("versions must be an array");
    const versions = ((body.versions as unknown[] | undefined) ?? []).map(parseVersion);
    const seen = new Set<string>();
    for (const v of versions) {
      if (seen.has(v.key)) fail(`duplicate version key: ${v.key}`, { key: v.key });
      seen.add(v.key);
    }

    const withdraw = parseKeyList(body.withdraw, "withdraw");
    const both = withdraw.filter((k) => seen.has(k));
    if (both.length > 0) fail("keys listed in both versions and withdraw", { keys: both });

    let online: SyncManifest["online"];
    if (body.online !== undefined) {
      if (!isObject(body.online)) fail("online must be an object");
      online = {
        key: optKey(body.online.key, "online.key"),
        periods: body.online.periods === undefined ? null : body.online.periods,
      };
    }

    let draft: ManifestDraft | null = null;
    if (body.draft !== undefined && body.draft !== null) {
      if (!isObject(body.draft)) fail("draft must be an object or null");
      draft = {
        line: optString(body.draft.line, "draft.line", 64),
        basedOn: optKey(body.draft.basedOn, "draft.basedOn"),
        files: parseFiles(body.draft.files, "draft"),
      };
    }

    if (body.hidden !== undefined && body.hidden !== null && !Array.isArray(body.hidden)) {
      fail("hidden must be an array");
    }
    const hidden = ((body.hidden as unknown[] | null | undefined) ?? []).map((h, i) => {
      if (!isObject(h) || !isValidKey(h.key)) fail(`hidden[${i}].key is not a valid key`);
      if (seen.has(h.key)) fail(`hidden key duplicates another key: ${h.key}`, { key: h.key });
      seen.add(h.key);
      return { key: h.key, files: optFiles(h.files, `hidden[${i}]`) };
    });

    let summary: string | null | undefined;
    if (body.project !== undefined && body.project !== null) {
      if (!isObject(body.project)) fail("project must be an object");
      if (body.project.summary !== undefined) {
        // 空串与 null 同义：清空简介
        summary = optString(body.project.summary, "project.summary", REPO_SUMMARY_MAX) || null;
      }
    }

    return { ok: true, manifest: { versions, withdraw, online, draft, hidden, summary } };
  } catch (e) {
    if (e instanceof ParseFail) return { ok: false, error: e.error };
    throw e;
  }
}

/** 机器清单的格式号（G-canvas change-manifest.ts 生成）。 */
export const CHANGE_MANIFEST_FORMAT = "prdlab-change/1";

/** 单份机器清单序列化后的上限（字节）；超过只丢清单，不让它拖垮整次推送。 */
export const CHANGE_MANIFEST_MAX_BYTES = 1024 * 1024;

export type ManifestRejectReason = "not_object" | "format" | "key" | "content_digest" | "too_large";

/**
 * 校验一份机器清单是否属于这一版：格式号、`version.key`、`contentDigest`（与服务端按文件表算的同一个）。
 * 只看这三处，其余字段原样存取（清单的粒度与形状由 G-canvas 定）。返回 null 表示可以存。
 */
export function checkChangeManifest(
  manifest: unknown,
  versionKey: string,
  contentDigest: string,
): ManifestRejectReason | null {
  if (!isObject(manifest)) return "not_object";
  if (manifest.format !== CHANGE_MANIFEST_FORMAT) return "format";
  if (!isObject(manifest.version) || manifest.version.key !== versionKey) return "key";
  if (manifest.contentDigest !== contentDigest) return "content_digest";
  if (Buffer.byteLength(JSON.stringify(manifest), "utf8") > CHANGE_MANIFEST_MAX_BYTES) return "too_large";
  return null;
}

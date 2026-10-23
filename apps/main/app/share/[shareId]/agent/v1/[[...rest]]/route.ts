import { shareResponse } from "@/lib/share/response";
import { Readable } from "node:stream";
import { getObjectStream } from "@prd-lab/core";
import {
  agentRoot,
  batchAdvice,
  checkPackBudget,
  checkRepoPath,
  fileRoles,
  formatBytes,
  getRepoView,
  isValidKey,
  listSnapshotFileLocations,
  listSnapshotFiles,
  loadRepoProject,
  lookupAgentVersion,
  findSnapshotFile,
  rawContentType,
  readChangeManifest,
  renderAgentReadme,
  renderPullRecord,
  renderVersionDoc,
  repoProjectIdOfVersion,
  resolveRepoVersion,
  scopeSummaries,
  selectFiles,
  versionLabel,
  AGENT_PACK_MAX_BYTES,
  RepoError,
  getRepoShare,
  type AgentFile,
  type AgentVersion,
  type PullScope,
  type RepoProject,
} from "@prd-lab/core/repo";
import { requestOrigin } from "@/lib/api/request-origin";
import { getShareSession } from "@/lib/share/share-session";
import { createZipStream, packConfig, packSlots, PACK_RETRY_AFTER_SECONDS } from "@/lib/agent/pack";
import { agentError, agentHeaders, agentJson, agentText } from "@/lib/agent/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ shareId: string; rest?: string[] }> };

const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

/**
 * GET /share/:shareId/agent/v1/…  给 AI 按版本拉取需求资料（用法见 R/README.md）
 *
 *   README.md                       完整用法（与「复制给 AI」的提示词同一模板）
 *   versions                        版本表（游标分页）、上线标记、默认版本；?v= / ?k= 附解析结果
 *   k/:key                          版本信息、改动清单摘要、两种范围的文件数与原始体积
 *   k/:key/files                    本版全部文件（含角色）
 *   k/:key/manifest.json            机器清单 prdlab-change/1 原样
 *   k/:key/raw/<路径>               单个文件原文（一律纯文本 / Markdown / 位图）
 *   k/:key/pull?scope=changes|all   或 ?paths=…  所选文件打成 zip
 *
 * 鉴权沿用访客链接：getShareSession（撤销 → 410，无密码放行，有密码按 cookie 与密码版本号）。
 * 选文件只能从「本版实际文件表」里选。全部回应 private, no-store。
 */
export async function GET(request: Request, ctx: Ctx) {
  return handle(request, ctx, false);
}

/**
 * HEAD：同样的鉴权与检查，只回响应头。不申请打包名额、不建压缩流、不读对象存储，
 * 状态码与 GET 一致（401 / 404 / 410 / 413 …），成功时 pull 回 200 + zip 头。
 */
export async function HEAD(request: Request, ctx: Ctx) {
  return handle(request, ctx, true);
}

async function handle(request: Request, { params }: Ctx, head: boolean): Promise<Response> {
  const res = await shareResponse(() => dispatch(request, { params }, head));
  return head && res.body !== null ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

async function dispatch(request: Request, { params }: Ctx, head: boolean): Promise<Response> {
  const { shareId, rest = [] } = await params;
  const origin = requestOrigin(request);

  const session = await getShareSession(shareId);
  if (session.kind === "unauthorized") {
    return agentError(401, "unauthorized", "私有项目需要账户身份", "请登录主站，或使用当前账户的有效 Bearer Token；分享密码不能代替账户登录");
  }
  if (session.kind === "forbidden") return agentError(404, "not_found", "项目不存在", "请联系项目创建者确认访问权");
  if (session.kind === "revoked") {
    return agentError(410, "share_revoked", "该访客链接已被撤销", "请向开发要新的访客链接");
  }
  if (session.kind === "not_found") {
    return agentError(404, "share_not_found", "访客链接不存在", "请核对链接号，或向开发要新的访客链接");
  }
  if (session.kind === "invalid") {
    return agentError(
      401,
      "password_required",
      "需要访问密码，或密码已被改过",
      `向 ${origin}/share/${shareId}/api/login 用 POST 提交 {"password":"…"}（JSON），并用 curl -c ./prd/.cookies 保存 cookie；` +
        "之后每条命令加 -b ./prd/.cookies。登录失败说明密码不对或已被改过，请向开发要新密码",
    );
  }

  const repoId = await repoProjectIdOfVersion(session.versionId);
  if (!repoId) {
    return agentError(404, "not_repo", "这个访客链接不是仓库项目的链接，没有版本拉取接口", "请向开发确认链接");
  }
  let repo: RepoProject;
  try {
    repo = await loadRepoProject(repoId);
  } catch (e) {
    if (e instanceof RepoError) return agentError(404, "not_found", "项目不存在", "请向开发确认链接");
    throw e;
  }

  const root = agentRoot(origin, shareId);
  const url = new URL(request.url);

  if (rest.length === 1 && rest[0] === "README.md") {
    const share = await getRepoShare(repo.versionId);
    const md = renderAgentReadme({
      projectName: repo.name,
      origin,
      shareId,
      hasPassword: share?.hasPassword ?? false,
    });
    return agentText(md, "text/markdown; charset=utf-8");
  }
  if (rest.length === 1 && rest[0] === "versions") return versionsResponse(repo, url);
  if (rest[0] === "k" && rest.length >= 2) {
    return versionResponse({ repo, root, key: rest[1]!, tail: rest.slice(2), url, request, head });
  }
  return agentError(404, "not_found", "没有这个地址", `接口用法见 ${root}/README.md`);
}

// ---------------------------------------------------------------------------------------------

async function versionsResponse(repo: RepoProject, url: URL): Promise<Response> {
  const { view, resolveInput } = await getRepoView(repo);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? DEFAULT_PAGE : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    return agentError(400, "invalid_limit", `limit 须是 1 到 ${MAX_PAGE} 的整数`, "去掉 limit 或改成合法值");
  }
  const cursor = url.searchParams.get("cursor");
  let start = 0;
  if (cursor) {
    const at = view.versions.findIndex((x) => x.key === cursor);
    if (at < 0) {
      return agentError(400, "invalid_cursor", "cursor 无效", "从头请求（不带 cursor），或使用上一页返回的 nextCursor");
    }
    start = at + 1;
  }
  const page = view.versions.slice(start, start + limit);
  const nextCursor = start + limit < view.versions.length ? page[page.length - 1]!.key : null;
  const v = url.searchParams.get("v");
  const k = url.searchParams.get("k");
  return agentJson({
    project: { name: view.project.name, summary: view.project.summary },
    versions: page.map((x) => ({
      key: x.key,
      kind: x.kind,
      number: x.number,
      name: x.name,
      line: x.line,
      parentKey: x.parentKey,
      patchOf: x.patchOf,
      sealedAt: x.sealedAt,
      online: view.online.key === x.key,
    })),
    total: view.versions.length,
    nextCursor,
    online: view.online,
    draft: view.draft ? { key: view.draft.key, line: view.draft.line, basedOn: view.draft.basedOn } : null,
    defaultVersionKey: view.defaultVersionKey,
    ...(v !== null || k !== null ? { resolved: resolveRepoVersion(resolveInput, v, k) } : {}),
  });
}

type VersionCtx = {
  repo: RepoProject;
  root: string;
  key: string;
  tail: string[];
  url: URL;
  request: Request;
  head: boolean;
};

async function versionResponse(c: VersionCtx): Promise<Response> {
  if (!isValidKey(c.key)) return notFoundVersion(c.root);
  const found = await lookupAgentVersion(c.repo.id, c.key);
  if (found.status === "not_found") return notFoundVersion(c.root);
  if (found.status === "withdrawn") {
    const next = found.replacement
      ? `替代它的是 ${versionLabel({ number: found.replacement.number, name: null })}：key=${found.replacement.key}`
      : `没有同号的替代版本，用 ${c.root}/versions 查看现有版本`;
    return agentError(410, "version_withdrawn", "这个版本已被撤回", next);
  }
  const version = found.version;
  const { tail } = c;

  if (tail.length === 0) return versionInfo(c, version);

  const files: AgentFile[] = await listSnapshotFiles(version.snapshotId);
  const manifest = readChangeManifest(version.manifest);

  if (tail.length === 1 && tail[0] === "files") {
    const roles = fileRoles(files, manifest, version.specDocs);
    return agentJson({
      key: version.key,
      files: files.map((f) => ({ ...f, role: roles.get(f.path) ?? "other" })),
    });
  }

  if (tail.length === 1 && tail[0] === "manifest.json") {
    if (!manifest) {
      return agentError(
        404,
        "no_manifest",
        "这一版推送时没有机器清单",
        `用 ${c.root}/k/${version.key}/pull?scope=all 或 paths 拉取，改动清单以 spec 文档为准`,
      );
    }
    return agentJson(version.manifest);
  }

  if (tail.length >= 2 && tail[0] === "raw") return rawResponse(c, version, tail.slice(1).join("/"));
  if (tail.length === 1 && tail[0] === "pull") return pullResponse(c, version, files, manifest);

  return agentError(404, "not_found", "没有这个地址", `接口用法见 ${c.root}/README.md`);
}

function notFoundVersion(root: string): Response {
  return agentError(404, "version_not_found", "没有这个版本", `用 ${root}/versions 查看现有版本及其 key`);
}

async function versionInfo(c: VersionCtx, v: AgentVersion): Promise<Response> {
  const [files, { view }] = await Promise.all([listSnapshotFiles(v.snapshotId), getRepoView(c.repo)]);
  const manifest = readChangeManifest(v.manifest);
  const scopes = scopeSummaries(files, manifest, v.specDocs);
  const base = `${c.root}/k/${v.key}`;
  return agentJson({
    project: { name: c.repo.name },
    version: {
      key: v.key,
      kind: v.kind,
      number: v.number,
      name: v.name,
      summary: v.summary,
      line: v.line,
      parentKey: v.parentKey,
      patchOf: v.patchOf,
      sealedAt: v.sealedAt,
      online: view.online.key === v.key,
    },
    hasManifest: manifest !== null,
    changeSummary: manifest
      ? {
          requirements: manifest.requirements.map((r) => ({
            id: r.id,
            change: r.change,
            title: r.title,
            itemCount: r.items.length,
          })),
          unassignedCount: manifest.unassigned.length,
        }
      : null,
    scopes: {
      changes: {
        fileCount: scopes.changes.fileCount,
        bytes: scopes.changes.bytes,
        ...(scopes.changes.noManifest ? { note: "这一版推送时没有机器清单：changes 只含 spec 文档" } : {}),
      },
      all: scopes.all,
    },
    limits: { maxPackBytes: AGENT_PACK_MAX_BYTES },
    links: {
      files: `${base}/files`,
      manifest: manifest ? `${base}/manifest.json` : null,
      pullChanges: `${base}/pull?scope=changes`,
      pullAll: `${base}/pull?scope=all`,
      pullPaths: `${base}/pull?paths=<路径1>,<路径2>`,
      raw: `${base}/raw/<路径>`,
    },
  });
}

async function rawResponse(c: VersionCtx, v: AgentVersion, relPath: string): Promise<Response> {
  if (checkRepoPath(relPath) !== null) {
    return agentError(400, "invalid_path", "路径不合法", `用 ${c.root}/k/${v.key}/files 查看本版文件路径`);
  }
  const file = await findSnapshotFile(v.snapshotId, relPath);
  if (!file) {
    return agentError(404, "file_not_found", "本版没有这个文件", `用 ${c.root}/k/${v.key}/files 查看本版文件路径`);
  }
  const headers = agentHeaders({ "Content-Type": rawContentType(relPath, file.contentType) });
  if (c.head) return new Response(null, { status: 200, headers });
  const obj = await getObjectStream(file.s3Key, c.request.signal);
  const stream = obj.stream;
  c.request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
  if (typeof obj.contentLength === "number") headers["Content-Length"] = String(obj.contentLength);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status: 200, headers });
}

function parsePullRequest(url: URL): { ok: true; scope: PullScope; paths: string[] } | { ok: false; res: Response } {
  const scopeRaw = url.searchParams.get("scope");
  const pathParams = url.searchParams.getAll("paths");
  const usage = "scope=changes（本版改动）、scope=all（整个版本）或 paths=<路径1>,<路径2>（二选一）";
  if (scopeRaw !== null && pathParams.length > 0) {
    return { ok: false, res: agentError(400, "ambiguous_pull", "scope 与 paths 不能同时给", `只保留一个：${usage}`) };
  }
  if (pathParams.length > 0) {
    // 单个 paths 值按逗号拆；路径里有逗号时重复写 paths=，每个值原样当作一条路径
    const paths = pathParams.length === 1 ? pathParams[0]!.split(",") : pathParams;
    return { ok: true, scope: "paths", paths: paths.filter((p) => p.trim() !== "") };
  }
  if (scopeRaw === "changes" || scopeRaw === "all") return { ok: true, scope: scopeRaw, paths: [] };
  return {
    ok: false,
    res: agentError(
      400,
      "invalid_scope",
      scopeRaw === null ? "没有指定拉取范围" : `不认识的 scope：${scopeRaw}`,
      `请指定 ${usage}`,
    ),
  };
}

async function pullResponse(
  c: VersionCtx,
  v: AgentVersion,
  files: AgentFile[],
  manifest: ReturnType<typeof readChangeManifest>,
): Promise<Response> {
  const parsed = parsePullRequest(c.url);
  if (!parsed.ok) return parsed.res;

  const selection = selectFiles({
    files,
    scope: parsed.scope,
    paths: parsed.paths,
    manifest,
    specDocs: v.specDocs,
  });

  // 开始回应前按原始体积预检；开始传 zip 以后就不能再改成 413 了
  const budget = checkPackBudget(selection.totalBytes);
  if (!budget.ok) {
    return agentError(
      413,
      "pack_too_large",
      `所选文件原始体积 ${formatBytes(budget.totalBytes)}，超过单次上限 ${formatBytes(budget.limit)}`,
      batchAdvice(selection.selected),
    );
  }

  const zipHeaders = agentHeaders({
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="prd-${v.key.slice(0, 8)}-${selection.scope}.zip"`,
  });
  if (c.head) return new Response(null, { status: 200, headers: zipHeaders });

  // 小下载（原始大小之和不超过 freeBytes）不占名额；更大的全站限同时数
  const cfg = packConfig();
  const release = selection.totalBytes <= cfg.freeBytes ? () => {} : packSlots.tryAcquire();
  if (!release) {
    return agentError(
      429,
      "pack_busy",
      "服务器正在打包其他请求",
      `${PACK_RETRY_AFTER_SECONDS} 秒后重试同一条命令`,
      { "Retry-After": String(PACK_RETRY_AFTER_SECONDS) },
    );
  }

  try {
    const [locations, { view }, share] = await Promise.all([
      listSnapshotFileLocations(v.snapshotId),
      getRepoView(c.repo),
      getRepoShare(c.repo.versionId),
    ]);
    const keyOf = new Map(locations.map((l) => [l.path, l.s3Key]));
    const doc = {
      projectName: c.repo.name,
      version: {
        key: v.key,
        number: v.number,
        name: v.name,
        summary: v.summary,
        line: v.line,
        kind: v.kind,
        sealedAt: v.sealedAt,
        online: view.online.key === v.key,
      },
      root: c.root,
      pulledAt: new Date(),
      selection,
      allFiles: files,
      manifest,
      specDocs: v.specDocs,
      hasPassword: share?.hasPassword ?? false,
    };
    const stream = createZipStream({
      entries: selection.selected.map((f) => ({ path: f.path, s3Key: keyOf.get(f.path)! })),
      extras: [
        { name: "PRD-VERSION.md", content: renderVersionDoc(doc) },
        { name: "prd-manifest.json", content: renderPullRecord({ ...doc, changeManifest: v.manifest }) },
      ],
      open: async (s3Key, signal) => (await getObjectStream(s3Key, signal)).stream,
      signal: c.request.signal,
      release,
    });
    return new Response(stream, { status: 200, headers: zipHeaders });
  } catch (e) {
    release();
    throw e;
  }
}

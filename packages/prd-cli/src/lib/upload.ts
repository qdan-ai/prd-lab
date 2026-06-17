import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ApiClient } from "./api-client";

/**
 * 项目/版本解析 + 自动建。
 *
 * lookup 走 `GET /api/v1/projects?view=switcher`（CLI 用户的视图 = 自己的 + team）。
 * 找不到时 autoCreate=true 会自动建 project 或 version（owner 或 team 项目管理员可建）。
 */

interface SwitcherVersion {
  id: string;
  name: string;
  seqNo: number;
}

interface SwitcherProject {
  id: string;
  name: string;
  visibility: "private" | "team";
  ownedByMe: boolean;
  /** owner 或 team 项目管理员 → 可上传 / 建方案（与后端 canManageProject 同口径）。
   *  optional：旧主站（S18 之前）switcher 响应无此字段，消费方需兜底到 ownedByMe。 */
  canManage?: boolean;
  versions: SwitcherVersion[];
}

export interface ResolveOptions {
  autoCreate?: boolean;
  visibility?: "private" | "team";
}

export interface ResolvedVersion {
  projectId: string;
  versionId: string;
  projectName: string;
  versionName: string;
  /** 本次 resolve 是否新建了 project / version */
  createdProject: boolean;
  createdVersion: boolean;
}

export async function resolveProjectVersion(
  client: ApiClient,
  projectName: string,
  versionName: string,
  opts: ResolveOptions = {},
): Promise<ResolvedVersion> {
  const list = await client.get<SwitcherProject[]>("/api/v1/projects?view=switcher");
  if (list.status !== 200 || !list.data) {
    throw new Error(`获取项目列表失败 (HTTP ${list.status}: ${list.error?.error_code ?? "unknown"})`);
  }

  const project = list.data.find((p) => p.name === projectName);
  if (project) {
    // canManage 兜底 ownedByMe：CLI 若早于主站升级，旧主站 switcher 无 canManage 字段，回退到 ownedByMe 不误拦 owner
    if (!(project.canManage ?? project.ownedByMe)) {
      throw new Error(`项目 "${projectName}" 非你拥有（也非团队管理员），无权上传`);
    }
    const version = project.versions.find((v) => v.name === versionName);
    if (version) {
      return {
        projectId: project.id,
        versionId: version.id,
        projectName,
        versionName,
        createdProject: false,
        createdVersion: false,
      };
    }
    if (!opts.autoCreate) {
      throw new Error(`方案 "${versionName}" 不存在于项目 "${projectName}"`);
    }
    const createRes = await client.postJson<{ id: string }>(
      `/api/v1/projects/${project.id}/versions`,
      { name: versionName },
    );
    if (createRes.status !== 201 || !createRes.data) {
      throw new Error(
        `创建方案失败 (HTTP ${createRes.status}: ${createRes.error?.error_code ?? "unknown"})`,
      );
    }
    return {
      projectId: project.id,
      versionId: createRes.data.id,
      projectName,
      versionName,
      createdProject: false,
      createdVersion: true,
    };
  }

  // 项目不存在 → autoCreate
  if (!opts.autoCreate) {
    throw new Error(`项目 "${projectName}" 不存在`);
  }
  // 建项目接口只建 project、返回 { project }，不建首个 version（项目与方案解耦）。
  // 故建项目后需再单独建首个方案，复用「项目已存在、方案缺失」同一个建方案接口。
  const createProjectRes = await client.postJson<{ project: { id: string; name: string } }>(
    "/api/v1/projects",
    { name: projectName, visibility: opts.visibility ?? "private" },
  );
  if (createProjectRes.status !== 201 || !createProjectRes.data) {
    throw new Error(
      `创建项目失败 (HTTP ${createProjectRes.status}: ${createProjectRes.error?.error_code ?? "unknown"})`,
    );
  }
  const newProjectId = createProjectRes.data.project.id;

  const createVersionRes = await client.postJson<{ id: string }>(
    `/api/v1/projects/${newProjectId}/versions`,
    { name: versionName },
  );
  if (createVersionRes.status !== 201 || !createVersionRes.data) {
    throw new Error(
      `创建方案失败 (HTTP ${createVersionRes.status}: ${createVersionRes.error?.error_code ?? "unknown"})`,
    );
  }
  return {
    projectId: newProjectId,
    versionId: createVersionRes.data.id,
    projectName,
    versionName,
    createdProject: true,
    createdVersion: true,
  };
}

export interface UploadOptions {
  zipPath: string;
  sha256: string;
  changeNote: string;
  uploaderType: "cli" | "mcp";
  /**
   * D11 / upload-renderer-selector：上传通道声明 renderer 的唯一渠道。
   * `default` / undefined / "" → 后端 rendererName=null（走裸 HTML）。
   * 注册表未知 renderer → 后端返 400 unknown_renderer + supported。
   */
  renderer?: string;
}

export interface UploadResult {
  status: number;
  snapshot?: {
    id: string;
    seqNo: number;
    contentSha256: string;
    changeNote: string;
  };
  duplicateOfActive?: boolean;
  matchedArchived?: unknown;
  error?: { error_code?: string; message?: string };
}

export async function uploadSnapshot(
  client: ApiClient,
  versionId: string,
  opts: UploadOptions,
): Promise<UploadResult> {
  const zipBuf = await readFile(opts.zipPath);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(zipBuf)], { type: "application/zip" });
  form.append("change_note", opts.changeNote);
  form.append("uploader_type", opts.uploaderType);
  if (opts.renderer && opts.renderer.trim()) {
    form.append("renderer", opts.renderer.trim());
  }
  form.append("file", blob, basename(opts.zipPath));

  const res = await fetch(`${client.endpoint}/api/v1/versions/${versionId}/snapshots`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${client.token}`,
      "Idempotency-Key": opts.sha256,
    },
    body: form,
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    let err: { error_code?: string; message?: string } = {};
    if (ct.includes("application/json")) {
      try {
        err = await res.json();
      } catch {
        // ignore
      }
    }
    return { status: res.status, error: err };
  }
  const body = (await res.json()) as Omit<UploadResult, "status">;
  return { status: res.status, ...body };
}

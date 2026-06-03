import { mutate as swrMutate } from "swr";
import { toast } from "sonner";

export type ApiError = {
  error_code: string;
  /**
   * D12 错误契约（upload-renderer-selector sprint）：
   *   - 顶层 error_code 是大类（如 validation_error / not_owner / not_found）
   *   - validation_error 下 message 承担 subcode 角色（如 unknown_renderer / renderer_requirements_unmet）
   *   - 前端按"先 subcode 后 error_code"两层映射，避免可读错误信息退化为通用「校验失败」
   */
  message?: string;
  details?: Record<string, unknown>;
};

/**
 * fetch wrapper：JSON 序列化、错误码标准化、自动 toast。
 * @throws ApiError - 网络错误或 HTTP 非 2xx
 */
export async function apiFetch<T>(
  input: string,
  init: RequestInit = {},
  { silent }: { silent?: boolean } = {},
): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let body: ApiError | null = null;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      // 非 JSON 错误（dev server 编译异常返回 HTML 错误页 / 网关 502 等）
    }
    const error: ApiError = body ?? {
      error_code: "network_error",
      message: `HTTP ${response.status} ${response.statusText || ""}`.trim(),
    };
    if (!silent) {
      toast.error(toastMessageForError(error), {
        description: body ? undefined : error.message,
      });
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const ERROR_TOAST_LABELS: Record<string, string> = {
  unauthorized: "请先登入",
  not_owner: "需要项目所有者权限",
  not_found: "对象不存在",
  name_conflict: "同名已存在",
  validation_error: "提交内容有误",
  snapshot_archived: "目标快照已被删除",
  snapshot_is_current: "无法删除当前快照",
  version_locked: "操作冲突，已为你刷新最新状态",
  share_already_exists: "该方案已有分享链接，请先撤销旧链接",
  share_not_found: "分享链接不存在",
  share_revoked: "分享链接已撤销",
  rate_limited: "失败次数过多，请 15 分钟后重试",
  content_duplicate: "内容与既有快照一致",
  version_label_conflict: "版本号已被占用",
  network_error: "网络错误，请重试",
};

function toastMessageForError(error: ApiError): string {
  return ERROR_TOAST_LABELS[error.error_code] ?? error.message ?? "操作失败";
}

/**
 * mutation 后批量 invalidate SWR cache。
 * 按 docs/09-data-flow.md "mutate cache key 清单" 调用。
 */
export function mutateKeys(keys: string[]): void {
  for (const key of keys) {
    swrMutate(key);
  }
}

// ---- API client 简易封装（按 docs/09 onSuccess 自动 mutate） ----

export const projectsApi = {
  list: () => apiFetch<unknown[]>("/api/v1/projects"),

  switcherView: () => apiFetch<SwitcherProject[]>("/api/v1/projects?view=switcher"),

  create: async (body: { name: string; visibility?: "private" | "team" }) => {
    const result = await apiFetch<{ project: ProjectRow }>(
      "/api/v1/projects",
      { method: "POST", body: JSON.stringify(body) },
    );
    mutateKeys(["/api/v1/projects?view=switcher", "/api/v1/projects"]);
    return result;
  },

  rename: async (pid: string, body: { name?: string; visibility?: "private" | "team" }) => {
    const result = await apiFetch<ProjectRow>(`/api/v1/projects/${pid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    mutateKeys(["/api/v1/projects?view=switcher", `/api/v1/projects/${pid}`]);
    return result;
  },

  archive: async (pid: string) => {
    await apiFetch<void>(`/api/v1/projects/${pid}`, { method: "DELETE" });
    mutateKeys(["/api/v1/projects?view=switcher", "/api/v1/projects"]);
  },
};

export const versionsApi = {
  listByProject: (pid: string) =>
    apiFetch<VersionRow[]>(`/api/v1/projects/${pid}/versions`),

  create: async (pid: string, body: { name: string }) => {
    const result = await apiFetch<VersionRow>(`/api/v1/projects/${pid}/versions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    mutateKeys(["/api/v1/projects?view=switcher", `/api/v1/projects/${pid}/versions`]);
    return result;
  },

  get: (vid: string) => apiFetch<VersionRow>(`/api/v1/versions/${vid}`),

  rename: async (vid: string, body: { name: string }) => {
    const result = await apiFetch<VersionRow>(`/api/v1/versions/${vid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    mutateKeys([`/api/v1/versions/${vid}`, "/api/v1/projects?view=switcher"]);
    return result;
  },

  archive: async (vid: string, pid: string) => {
    await apiFetch<void>(`/api/v1/versions/${vid}`, { method: "DELETE" });
    mutateKeys([
      "/api/v1/projects?view=switcher",
      `/api/v1/projects/${pid}/versions`,
    ]);
  },
};

export const snapshotsApi = {
  list: (vid: string) =>
    apiFetch<SnapshotRow[]>(`/api/v1/versions/${vid}/snapshots`),

  upload: async (
    vid: string,
    body: {
      file: File;
      changeNote: string;
      versionLabel?: string;
      forceNew?: boolean;
      renderer?: string;
    },
    opts?: { idempotencyKey?: string; silent?: boolean },
  ) => {
    const fd = new FormData();
    // text fields 放在 file 之前，避免 multipart 流式解析对大 binary 后字段的潜在丢失
    fd.set("change_note", body.changeNote);
    if (body.versionLabel && body.versionLabel.trim()) {
      fd.set("version_label", body.versionLabel.trim());
    }
    if (body.forceNew) fd.set("force_new", "true");
    if (body.renderer && body.renderer.trim()) {
      fd.set("renderer", body.renderer.trim());
    }
    fd.set("file", body.file);
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const result = await apiFetch<{
      snapshot: SnapshotInsertRow;
      matchedArchived: { seqNo: number; deletedAt: string } | null;
      duplicateOfActive?: boolean;
    }>(
      `/api/v1/versions/${vid}/snapshots`,
      { method: "POST", body: fd, headers },
      { silent: opts?.silent },
    );
    mutateKeys([
      `/api/v1/versions/${vid}/snapshots`,
      `/api/v1/versions/${vid}`,
      "/api/v1/projects?view=switcher",
    ]);
    return result;
  },

  rename: async (
    sid: string,
    vid: string,
    body: { change_note?: string; version_label?: string | null },
  ) => {
    const result = await apiFetch<SnapshotInsertRow>(`/api/v1/snapshots/${sid}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    mutateKeys([`/api/v1/versions/${vid}/snapshots`]);
    return result;
  },

  archive: async (sid: string, vid: string) => {
    await apiFetch<void>(`/api/v1/snapshots/${sid}`, { method: "DELETE" });
    mutateKeys([
      `/api/v1/versions/${vid}/snapshots`,
      `/api/v1/versions/${vid}`,
      "/api/v1/projects?view=switcher",
    ]);
  },

  refreshPreviewToken: (sid: string) =>
    apiFetch<{ token: string; expiresIn: number }>(
      `/api/v1/snapshots/${sid}/preview-token`,
      { method: "POST" },
    ),
};

// ---- snapshot files API (S9) ----

export type SnapshotFileRow = {
  relPath: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export const filesApi = {
  list: (sid: string) => apiFetch<{ files: SnapshotFileRow[] }>(`/api/v1/snapshots/${sid}/files`),
};

/** Renderer 注册表（upload-renderer-selector sprint）。UploadSnapshotModal 渲染 select 用。 */
export type RendererOption = {
  id: string;
  displayName: string;
  description: string;
};

export const renderersApi = {
  list: () => apiFetch<RendererOption[]>("/api/v1/renderers"),
};

/**
 * S5 分享链接 owner 侧 API。
 * onSuccess mutate：/api/v1/versions/${vid}/shares
 */
export const sharesApi = {
  getForSnapshot: (sid: string) =>
    apiFetch<{ share: ShareRow | null }>(`/api/v1/snapshots/${sid}/shares`),

  create: async (sid: string, body: { password: string }) => {
    const result = await apiFetch<{ share: ShareRow }>(
      `/api/v1/snapshots/${sid}/shares`,
      { method: "POST", body: JSON.stringify(body) },
    );
    mutateKeys([`/api/v1/snapshots/${sid}/shares`]);
    return result;
  },

  update: async (shareId: string, sid: string, body: { password: string }) => {
    const result = await apiFetch<{ share: ShareRow }>(
      `/api/v1/shares/${shareId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    mutateKeys([`/api/v1/snapshots/${sid}/shares`]);
    return result;
  },

  revoke: async (shareId: string, sid: string) => {
    await apiFetch<void>(`/api/v1/shares/${shareId}`, { method: "DELETE" });
    mutateKeys([`/api/v1/snapshots/${sid}/shares`]);
  },
};

export type ShareRow = {
  shareId: string;
  createdAt: string;
  passwordVersion: number;
};

// ---- types ----

export type SnapshotRow = {
  id: string;
  seqNo: number;
  versionLabel: string | null;
  changeNote: string;
  uploaderName: string;
  uploaderType: "user" | "mcp" | "cli";
  createdAt: string;
  contentSha256: string;
  entryHtmlPath: string;
  fileCount: number;
  totalSizeBytes: number;
};

export type SnapshotInsertRow = {
  id: string;
  versionId: string;
  seqNo: number;
  versionLabel: string | null;
  changeNote: string;
  createdAt: string;
};

export type ProjectRow = {
  id: string;
  name: string;
  ownerId: string;
  visibility: "private" | "team";
  createdAt: string;
  archivedAt: string | null;
};

export type VersionRow = {
  id: string;
  projectId: string;
  name: string;
  seqNo: number;
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
};

export type SwitcherProject = {
  id: string;
  name: string;
  visibility: "private" | "team";
  ownedByMe: boolean;
  versions: Array<{
    id: string;
    name: string;
    seqNo: number;
    activeCount: number;
    latestSnapshotSeq: number | null;
    latestSnapshot: {
      seqNo: number;
      versionLabel: string | null;
      uploaderName: string;
      createdAt: string;
      changeNote: string;
    } | null;
  }>;
};

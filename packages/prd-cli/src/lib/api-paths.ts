/**
 * REST API 路径常量集中。
 * 改 URL 时只动这里，子命令文件不直接拼字符串。
 */

export const API = {
  me: "/api/v1/me",
  projects: "/api/v1/projects",
  projectsSwitcher: "/api/v1/projects?view=switcher",
  project: (pid: string) => `/api/v1/projects/${pid}`,
  projectVersions: (pid: string) => `/api/v1/projects/${pid}/versions`,
  version: (vid: string) => `/api/v1/versions/${vid}`,
  versionSnapshots: (vid: string) => `/api/v1/versions/${vid}/snapshots`,
  snapshot: (sid: string) => `/api/v1/snapshots/${sid}`,
  snapshotShares: (sid: string) => `/api/v1/snapshots/${sid}/shares`,
  share: (shareId: string) => `/api/v1/shares/${shareId}`,
} as const;

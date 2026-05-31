import type { AnchorsFile } from "./types";

/**
 * 子资源 fetch 包装。
 *
 * 所有请求走相对路径，依赖 SPA HTML 同 origin 的 prd-preview-{sid} cookie 鉴权；
 * 不在前端管 token。
 */

export async function fetchText(baseUrl: string, relPath: string): Promise<string> {
  const url = baseUrl + relPath;
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    throw new FetchError(res.status, `GET ${relPath} → ${res.status}`);
  }
  return await res.text();
}

export async function fetchJson<T>(baseUrl: string, relPath: string): Promise<T> {
  const text = await fetchText(baseUrl, relPath);
  return JSON.parse(text) as T;
}

export async function fetchAnchorsOptional(
  baseUrl: string,
  hasAnchors: boolean,
): Promise<AnchorsFile | null> {
  if (!hasAnchors) return null;
  try {
    return await fetchJson<AnchorsFile>(baseUrl, "docs/anchors.json");
  } catch (e) {
    // anchors.json 可能损坏；不影响主面板可用性，吞错只记 console
    console.warn("[pm-canvas] fetch anchors.json failed:", e);
    return null;
  }
}

export class FetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

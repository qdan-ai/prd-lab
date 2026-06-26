/**
 * 子资源 fetch 包装（从 pm-canvas 的 api.ts 精简而来，去掉 anchors 相关逻辑）。
 *
 * 所有请求走相对路径，依赖 SPA HTML 同 origin 的 prd-preview-{sid} cookie 鉴权；
 * 不在前端管 token。
 *
 * dataBaseUrl 约定结尾带斜杠（如 `/p/{snapshotId}/`），故 relPath 不带前导斜杠，
 * 由本模块统一拼接 —— 避免调用方各自拼路径产生双斜杠/漏转义。
 */

/**
 * 把 baseUrl + relPath 拼成可直接用于 fetch / <img src> 的 URL。
 *
 * 按 path segment 做 encodeURIComponent，防止文件名含 `#`、`?`、空格、CJK 等
 * 字符被浏览器解释成 fragment/query。zip-utils 已禁 `..` 与控制字符，
 * 这里只解决合法字符的转义问题。
 */
export function resolveUrl(baseUrl: string, relPath: string): string {
  return baseUrl + relPath.split("/").map(encodeURIComponent).join("/");
}

export async function fetchText(baseUrl: string, relPath: string): Promise<string> {
  const url = resolveUrl(baseUrl, relPath);
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

export class FetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/**
 * fetch wrapper 注入 Authorization: Bearer。
 *
 * 不抛出 HTTPError —— 让调用方拿到 status / error_code 做精确处理。
 */

export interface ApiClientOptions {
  endpoint: string;
  token: string;
}

export interface ApiErrorBody {
  error_code?: string;
  message?: string;
}

export class ApiClient {
  readonly endpoint: string;
  readonly token: string;

  constructor(opts: ApiClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/$/, "");
    this.token = opts.token;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    init: {
      body?: BodyInit | null;
      headers?: Record<string, string>;
      raw?: boolean;
    } = {},
  ): Promise<{ status: number; data: T | null; error?: ApiErrorBody }> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      ...(init.headers ?? {}),
    };
    const res = await fetch(`${this.endpoint}${path}`, {
      method,
      headers,
      body: init.body,
    });
    if (init.raw) {
      return { status: res.status, data: res as unknown as T };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      let body: ApiErrorBody = {};
      if (ct.includes("application/json")) {
        try {
          body = (await res.json()) as ApiErrorBody;
        } catch {
          // ignore parse failure
        }
      }
      return { status: res.status, data: null, error: body };
    }
    if (res.status === 204) return { status: 204, data: null };
    if (!ct.includes("application/json")) {
      return { status: res.status, data: null };
    }
    return { status: res.status, data: (await res.json()) as T };
  }

  get<T = unknown>(path: string) {
    return this.request<T>("GET", path);
  }

  postJson<T = unknown>(path: string, body: unknown, extra: Record<string, string> = {}) {
    return this.request<T>("POST", path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...extra },
    });
  }

  patchJson<T = unknown>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }
}

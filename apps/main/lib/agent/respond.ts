/** 给 AI 的接口（/share/<链接号>/agent/v1）统一的回应头与 JSON 错误格式。 */

/** 所有回应共用：不缓存（状态、权限、撤回随时会变）、不嗅探类型、沙箱化（主站域名下原型脚本不能运行）。 */
export function agentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    ...extra,
  };
}

export function agentJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: agentHeaders(extra) });
}

/** 错误：状态码对，正文 JSON `{ error, message, next }`，`next` 写下一步怎么做。 */
export function agentError(
  status: number,
  error: string,
  message: string,
  next: string,
  extra: Record<string, string> = {},
): Response {
  return agentJson({ error, message, next }, status, extra);
}

export function agentText(body: string, contentType: string): Response {
  return new Response(body, { status: 200, headers: agentHeaders({ "Content-Type": contentType }) });
}

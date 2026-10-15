/**
 * S20 防开放重定向：两个 preview-refresh 端点共用的 `next` 参数白名单校验。
 *
 * next 必须正好是 `/p/{sid}` 或落在 `/p/{sid}/` 之下（长度 ≤ 2048 防超长 Location 头），
 * 否则 fallback 到该 snapshot 的预览入口。重定向目标 origin 另行来自 HMAC claim /
 * 本站 env，绝不取自请求参数。
 *
 * 额外拒控制字符：searchParams.get 会把 `%0A` 解码成真换行，拼进 Location 头即是
 * 响应头注入面（Node 的 Headers 校验虽会抛错，但那是 500 不是预期行为）。
 */
export function sanitizeNextPath(rawNext: string | null, sid: string): string {
  return sanitizeUnder(rawNext, `/p/${sid}`);
}

/** 仓库查看器（预览站 /r/{pid}）的同一套校验：next 只能落在 `/r/{pid}` 之下。 */
export function sanitizeRepoNextPath(rawNext: string | null, pid: string): string {
  return sanitizeUnder(rawNext, `/r/${pid}`);
}

function sanitizeUnder(rawNext: string | null, prefix: string): string {
  if (
    rawNext &&
    rawNext.length <= 2048 &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/.test(rawNext) &&
    (rawNext === prefix || rawNext.startsWith(`${prefix}/`))
  ) {
    return rawNext;
  }
  return `${prefix}/`;
}

/**
 * S20 Hotfix R1：求"浏览器视角"的主站 origin。
 *
 * 背景：Next standalone（生产 docker）下 route handler 的 `request.url` origin 是容器
 * 内部监听地址（http://0.0.0.0:3000），不跟随 Host 头——`new URL(request.url).origin`
 * 在生产会把 origin claim / login callbackUrl 都算成浏览器不可达的地址。
 * 本地 dev 与单测（直调 handler 传绝对 URL）不暴露该差异。
 *
 * 取值优先级：
 *   1. APP_ORIGIN env（显式配置；同时消除 Host 头欺骗进 origin claim 的钓鱼面）
 *   2. x-forwarded-host / host 头（nginx.prod.conf 已 proxy_set_header Host $host）
 *   3. new URL(request.url).origin 兜底（单测直调路径，行为与改造前一致）
 */
export function requestOrigin(request: Request): string {
  return headersOrigin(request.headers) ?? new URL(request.url).origin;
}

/**
 * 只凭请求头求浏览器视角 origin（取值优先级同上的 1、2 两步）；都没有时返回 null。
 * 供拿不到 Request 对象的 Server Component（如分享页）使用。
 */
export function headersOrigin(headers: Headers): string | null {
  const fromEnv = process.env.APP_ORIGIN;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? "http";
    // 多级代理时两头都可能是逗号分隔列表，取第一跳
    return `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`;
  }
  return null;
}

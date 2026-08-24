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
  const fromEnv = process.env.APP_ORIGIN;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    // 多级代理时两头都可能是逗号分隔列表，取第一跳
    return `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`;
  }

  return new URL(request.url).origin;
}

/**
 * CSP for renderer SPA shell（DESIGN §6.6 / 决策 D15 / D22）；仓库查看器外壳（/r/<pid>/）同用。
 *
 * 关键点：
 *   - frame-src 仅放行 viewer.diagrams.net（D22 drawio embed），不给 *.diagrams.net 通配
 *   - script-src/style-src 含 'unsafe-inline'：renderer SPA 注入的 inline config + 画板内联 style
 *   - frame-ancestors 'self' 与 X-Frame-Options:SAMEORIGIN 对齐，防 clickjacking
 *   - default 子资源路径不返回 CSP，仅外壳 HTML 挂此头
 */
export function buildRendererCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' https://viewer.diagrams.net",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

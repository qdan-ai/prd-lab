/**
 * 跨站请求伪造（CSRF）止血：判定一个状态变更请求是否来自主站自身页面。
 *
 * 背景：生产主站 :80 与预览站 :8081 同 IP 只差端口 → 浏览器视为同站点，SameSite=Lax 的
 * 会话 cookie 会随预览站（托管不可信 HTML/JS）发起的请求带上。治本是预览站换独立域名；
 * 这里在 proxy.ts 层统一拦截「浏览器跨源发来的写请求」。
 *
 * 判定顺序（命中即返回）：
 *   1. GET / HEAD / OPTIONS → 放行（安全方法，本项目没有靠 GET 做状态变更的接口）
 *   2. /api/auth/* → 放行（NextAuth 自带 csrfToken 双提交校验）
 *   3. 带 `Authorization: Bearer` → 放行（CLI / API token 路径；浏览器跨源附加该头必触发
 *      预检，主站无 CORS 响应头，预检失败请求根本不会发出）
 *   4. 有 Sec-Fetch-Site（浏览器设置，页面脚本无法伪造）→ same-origin / none 放行，
 *      same-site / cross-site 拒绝。注意浏览器只对 HTTPS / localhost 发该头，
 *      生产走 http://IP 时不会有，落到第 5 步
 *   5. 有 Origin → 与主站自身比对：等于 APP_ORIGIN，或 host 等于 x-forwarded-host / host 头
 *      则放行，否则拒绝；`Origin: null`（sandbox iframe 等）一律拒绝
 *   6. 两个头都没有 → 放行（curl / CLI / 服务端调用不带 Origin；现代浏览器对 POST/PUT/PATCH/
 *      DELETE 一定带 Origin，不带的只有很老的浏览器，接受这个残余风险）
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfInput = {
  method: string;
  pathname: string;
  headers: Headers;
};

export type CsrfVerdict = { ok: true } | { ok: false; reason: string };

export function checkCsrf({ method, pathname, headers }: CsrfInput): CsrfVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return { ok: true };
  if (/^bearer\s/i.test(headers.get("authorization") ?? "")) return { ok: true };

  const site = headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin" || site === "none") return { ok: true };
    return { ok: false, reason: `sec-fetch-site: ${site}` };
  }

  const origin = headers.get("origin");
  if (origin === null) return { ok: true };
  if (isSelfOrigin(origin, headers)) return { ok: true };
  return { ok: false, reason: `origin: ${origin.slice(0, 100)}` };
}

function isSelfOrigin(origin: string, headers: Headers): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // 含 `Origin: null`（sandbox iframe / data: 页面）
  }

  const fromEnv = process.env.APP_ORIGIN;
  if (fromEnv) {
    try {
      if (new URL(fromEnv).host.toLowerCase() === originHost) return true;
    } catch {
      // APP_ORIGIN 配错时不因此放行，继续看 host 头
    }
  }

  // 与 Next Server Actions 的同源校验口径一致：只比 host（含端口），不比协议
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return false;
  return host.split(",")[0]!.trim().toLowerCase() === originHost;
}

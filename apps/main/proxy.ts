import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { checkCsrf } from "@/lib/api/csrf";
import { errorResponse } from "@/lib/api/errors";

const PROTECTED_PREFIXES = ["/projects"];

// 第二个参数标成 NextFetchEvent，让 auth() 选中间件重载（返回 NextMiddleware）
const authProxy = auth((req, _event: NextFetchEvent) => {
  const { pathname, search } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();
  if (req.auth?.user?.id) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?callbackUrl=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  // CSRF 止血：浏览器跨源发来的写请求一律 403（判定规则见 lib/api/csrf.ts）
  const verdict = checkCsrf({
    method: req.method,
    pathname: req.nextUrl.pathname,
    headers: req.headers,
  });
  if (!verdict.ok) {
    return errorResponse("cross_site_request", "请求来源不是本站，已拒绝", { reason: verdict.reason });
  }

  // 登入跳转只管 /projects/*；其它路径（CSRF 匹配进来的）不跑 NextAuth 会话解析
  if (!PROTECTED_PREFIXES.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next();
  }
  return authProxy(req, event);
}

export const config = {
  matcher: [
    "/projects/:path*",
    // 带 Origin 头的请求（浏览器的写请求都会带）全站过一遍 CSRF 判定。
    // 不带 Origin 的请求（CLI / curl / 浏览器同源 GET）不进 proxy：判定本就放行，
    // 且 proxy 会把请求体复制一份（见 next.config.ts proxyClientMaxBodySize），没必要碰大上传。
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      has: [{ type: "header", key: "origin" }],
    },
  ],
};

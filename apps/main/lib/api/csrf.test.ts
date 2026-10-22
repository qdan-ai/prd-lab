import { afterEach, describe, expect, it } from "vitest";
import { checkCsrf } from "./csrf";

const MAIN_HOST = "10.0.0.1"; // 生产主站 :80（nginx 以 $host 透传，不带端口）
const PREVIEW_ORIGIN = "http://10.0.0.1:8081"; // 同 IP 不同端口的预览站

function req(
  method: string,
  headers: Record<string, string>,
  pathname = "/api/v1/projects",
) {
  return checkCsrf({ method, pathname, headers: new Headers(headers) });
}

afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("checkCsrf", () => {
  it("安全方法放行，即使来源是预览站", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(req(m, { host: MAIN_HOST, origin: PREVIEW_ORIGIN, "sec-fetch-site": "same-site" })).toEqual({ ok: true });
    }
  });

  it("预览站（同 IP 不同端口）发来的写请求被拒，覆盖 POST/PUT/PATCH/DELETE", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      const v = req(m, { host: MAIN_HOST, origin: PREVIEW_ORIGIN });
      expect(v.ok).toBe(false);
    }
  });

  it("本机复现形态：localhost:3001 → localhost:3000 被拒", () => {
    expect(req("POST", { host: "localhost:3000", origin: "http://localhost:3001" }).ok).toBe(false);
  });

  it("同源写请求放行（Origin host 等于 Host 头）", () => {
    expect(req("POST", { host: MAIN_HOST, origin: `http://${MAIN_HOST}` })).toEqual({ ok: true });
    expect(req("POST", { host: "localhost:3000", origin: "http://localhost:3000" })).toEqual({ ok: true });
    expect(req("POST", { host: "App.Local", origin: "http://app.local" })).toEqual({ ok: true });
  });

  it("Origin: null（sandbox iframe 等）被拒", () => {
    expect(req("POST", { host: MAIN_HOST, origin: "null" }).ok).toBe(false);
  });

  it("Origin 无法解析被拒", () => {
    expect(req("POST", { host: MAIN_HOST, origin: "not a url" }).ok).toBe(false);
  });

  it("没有 Host 头时无法证明同源，被拒", () => {
    expect(req("POST", { origin: `http://${MAIN_HOST}` }).ok).toBe(false);
  });

  it("既无 Origin 也无 Sec-Fetch-Site（curl / CLI / 服务端调用）放行", () => {
    expect(req("POST", { host: MAIN_HOST })).toEqual({ ok: true });
    expect(req("DELETE", {})).toEqual({ ok: true });
  });

  it("Authorization: Bearer 放行，即使 Origin 是跨源", () => {
    expect(req("POST", { host: MAIN_HOST, origin: PREVIEW_ORIGIN, authorization: "Bearer prd_xxx" })).toEqual({ ok: true });
    expect(req("PUT", { host: MAIN_HOST, origin: "null", authorization: "bearer prd_xxx" })).toEqual({ ok: true });
  });

  it("非 Bearer 的 Authorization 不享受豁免", () => {
    expect(req("POST", { host: MAIN_HOST, origin: PREVIEW_ORIGIN, authorization: "Basic abc" }).ok).toBe(false);
  });

  it("NextAuth 自身路由 /api/auth/* 放行（它有自己的 csrfToken），相似前缀不放行", () => {
    expect(req("POST", { host: MAIN_HOST, origin: PREVIEW_ORIGIN }, "/api/auth/signout")).toEqual({ ok: true });
    expect(req("POST", { host: MAIN_HOST, origin: PREVIEW_ORIGIN }, "/api/authx").ok).toBe(false);
  });

  it("访客侧 /share/* 写接口同样受检", () => {
    expect(req("POST", { host: MAIN_HOST, origin: PREVIEW_ORIGIN }, "/share/abc/api/login").ok).toBe(false);
    expect(req("POST", { host: MAIN_HOST, origin: `http://${MAIN_HOST}` }, "/share/abc/api/login")).toEqual({ ok: true });
  });

  it("Sec-Fetch-Site 优先于 Origin：same-origin / none 放行", () => {
    // host 头对不上（如代理改写）时，浏览器给的 same-origin 仍可信
    expect(req("POST", { host: "0.0.0.0:3000", origin: "https://prd.example.com", "sec-fetch-site": "same-origin" })).toEqual({ ok: true });
    expect(req("POST", { host: MAIN_HOST, "sec-fetch-site": "none" })).toEqual({ ok: true });
  });

  it("Sec-Fetch-Site same-site / cross-site 被拒（即使 Origin 看起来同源）", () => {
    expect(req("POST", { host: MAIN_HOST, origin: `http://${MAIN_HOST}`, "sec-fetch-site": "same-site" }).ok).toBe(false);
    expect(req("POST", { host: MAIN_HOST, "sec-fetch-site": "cross-site" }).ok).toBe(false);
  });

  it("APP_ORIGIN 命中放行（Host 头是容器内部地址时）", () => {
    process.env.APP_ORIGIN = "http://10.0.0.1/";
    expect(req("POST", { host: "0.0.0.0:3000", origin: "http://10.0.0.1" })).toEqual({ ok: true });
    expect(req("POST", { host: "0.0.0.0:3000", origin: PREVIEW_ORIGIN }).ok).toBe(false);
  });

  it("x-forwarded-host 优先于 host，取第一跳", () => {
    expect(req("POST", { host: "main:3000", "x-forwarded-host": `${MAIN_HOST}, proxy`, origin: `http://${MAIN_HOST}` })).toEqual({ ok: true });
    expect(req("POST", { host: MAIN_HOST, "x-forwarded-host": "other.example", origin: `http://${MAIN_HOST}` }).ok).toBe(false);
  });
});

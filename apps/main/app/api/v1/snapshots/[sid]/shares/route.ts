/**
 * @deprecated S19：share 已改为方案（version）级。
 * 调用方请改用 `/api/v1/versions/{vid}/shares`。
 * 此路由保留返 410 Gone 作过渡（避免 404 看似路由配置错误；保护旧版 CLI/skill 存量调用）。
 */

const GONE_BODY = {
  error_code: "version_locked",
  message: "S19 deprecated: share 已改为方案级，请改用 /api/v1/versions/{vid}/shares",
} as const;

export async function GET() {
  return Response.json(GONE_BODY, { status: 410 });
}

export async function POST() {
  return Response.json(GONE_BODY, { status: 410 });
}

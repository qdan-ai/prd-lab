/**
 * @deprecated S8：share 已升级为 snapshot 级。
 * 调用方请改用 `/api/v1/snapshots/{sid}/shares`。
 * 此路由保留返 410 Gone 作过渡（避免 404 看似路由配置错误）。
 */

const GONE_BODY = {
  error_code: "version_locked",
  message: "S8 deprecated: share 已改为 snapshot 级，请改用 /api/v1/snapshots/{sid}/shares",
} as const;

export async function GET() {
  return Response.json(GONE_BODY, { status: 410 });
}

export async function POST() {
  return Response.json(GONE_BODY, { status: 410 });
}

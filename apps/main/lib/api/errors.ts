/**
 * 标准 mutation error_code 集（docs/01-data-model.md §"完整 mutation error_code 集"）
 * S1 扩展了 not_found / unauthorized / name_conflict，作为通用 HTTP 错误码
 */
export const errorCodes = {
  // ---- docs/01 列的 5 个核心 ----
  not_owner: { status: 403 },
  snapshot_archived: { status: 409 }, // S2 才用
  snapshot_is_current: { status: 409 }, // S2 才用
  version_locked: { status: 409 },
  validation_error: { status: 400 },
  // ---- S1 通用扩展 ----
  unauthorized: { status: 401 },
  not_found: { status: 404 },
  name_conflict: { status: 409 },
  // ---- S5 分享链接 ----
  share_already_exists: { status: 409 }, // 同 version 已存在 active share_link
  share_not_found: { status: 404 }, // share_id 不存在 / 已撤销
  share_revoked: { status: 410 }, // share 已 revoked_at（访客访问）
  rate_limited: { status: 429 }, // login 5 失败/15min 锁定期内（不进 bcrypt）
  // ---- S6 CLI/MCP token ----
  token_invalid: { status: 401 }, // Authorization Bearer 解不出对应 api_token
  token_revoked: { status: 401 }, // api_token.revoked_at 已写
  // ---- S7 PM 主动权 ----
  content_duplicate: { status: 409 }, // sha256 命中 active snapshot；user 路径触发二次确认
  version_label_conflict: { status: 409 }, // 同方案下已有活跃 snapshot 占用此 version_label
} as const;

export type ErrorCode = keyof typeof errorCodes;

export function errorResponse(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    { error_code: code, message: message ?? code, ...(details ? { details } : {}) },
    { status: errorCodes[code].status },
  );
}

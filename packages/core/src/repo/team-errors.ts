import { TEAM_ERROR_STATUS, type TeamErrorCode } from "./team-contract";

/**
 * 团队接口的业务错误：错误码与 HTTP 状态一一对应（见契约 `TEAM_ERROR_STATUS`）。
 * 路由层把它转成标准错误体 `{ error_code, message, details? }`；`headers` 原样带到响应上（如 `Retry-After`）。
 */
export class TeamError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    message?: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
  }

  get status(): number {
    return TEAM_ERROR_STATUS[this.code];
  }
}

/** 400 validation_error：`reason` 是小写下划线的原因码，位置与数值放 `details`。 */
export function validationError(reason: string, details?: Record<string, unknown>): TeamError {
  return new TeamError("validation_error", reason, details);
}

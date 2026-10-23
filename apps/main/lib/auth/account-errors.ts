import { errorResponse, type ErrorCode } from "@/lib/api/errors";
import { AuthenticationUnavailableError, LoginLockedError } from "./errors";

export class AccountError extends Error {
  constructor(public readonly code: ErrorCode, message: string = code, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}

/** Auth.js may wrap the original error in AuthError.cause.err. */
export function accountErrorResponse(error: unknown): Response {
  let current = error;
  for (let i = 0; i < 6 && current; i++) {
    if (current instanceof AccountError) return errorResponse(current.code, current.message, current.details);
    if (current instanceof LoginLockedError) {
      return errorResponse("login_locked", undefined, { lockedUntil: current.lockedUntil.toISOString() });
    }
    if (current instanceof AuthenticationUnavailableError) {
      return errorResponse("authentication_unavailable", undefined, { retryable: true });
    }
    const cause = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
    current = cause && typeof cause === "object" && "err" in cause ? cause.err : cause;
  }
  // Do not expose database/credential details. Unexpected failures are not silently accepted.
  throw error;
}

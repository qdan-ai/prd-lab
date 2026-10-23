import { CredentialsSignin } from "next-auth";

/** Safe public code; server actions can use lockedUntil without putting account data into the redirect URL. */
export class LoginLockedError extends CredentialsSignin {
  override code = "login_locked";
  constructor(public readonly lockedUntil: Date) {
    super("Login temporarily locked");
  }
}

export class AuthenticationUnavailableError extends Error {
  readonly code = "authentication_unavailable";
  readonly status = 503;
  readonly retryable = true;
  constructor(options?: ErrorOptions) {
    super("Authentication temporarily unavailable; retry the request", options);
    this.name = "AuthenticationUnavailableError";
  }
}

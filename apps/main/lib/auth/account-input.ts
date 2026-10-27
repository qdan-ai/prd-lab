import { isValidPersonalPassword } from "./credentials";
import { AccountError } from "./account-errors";

export async function readAccountBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new AccountError("validation_error", "invalid JSON"); }
}

function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccountError("validation_error", "body must be JSON object");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new AccountError("validation_error", "unknown_fields");
  }
  return body;
}

function name(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if ([...normalized].length < 1 || [...normalized].length > 64 || normalized.includes("@")) {
    throw new AccountError("validation_error", "invalid_name", { field: "name" });
  }
  return normalized;
}

function email(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized.length > 255 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized)) {
    throw new AccountError("validation_error", "invalid_email", { field: "email" });
  }
  return normalized;
}

function password(value: unknown, confirmation: unknown, field = "password"): string {
  if (!isValidPersonalPassword(value)) {
    throw new AccountError("validation_error", "invalid_password", { field });
  }
  if (value !== confirmation) {
    throw new AccountError("validation_error", "password_mismatch", { field: "confirmPassword" });
  }
  return value;
}

export function parseRegistration(value: unknown) {
  const b = fields(value, ["name", "email", "password", "confirmPassword"]);
  return { name: name(b.name), email: email(b.email), password: password(b.password, b.confirmPassword) };
}

export function parseProfile(value: unknown): { name?: string; email?: string } {
  const b = fields(value, ["name", "email"]);
  if (!Object.keys(b).length) throw new AccountError("validation_error", "no_fields");
  return { ...("name" in b ? { name: name(b.name) } : {}), ...("email" in b ? { email: email(b.email) } : {}) };
}

export function parsePasswordChange(value: unknown) {
  const b = fields(value, ["currentPassword", "newPassword", "confirmPassword"]);
  if (typeof b.currentPassword !== "string") throw new AccountError("validation_error", "current_password_required");
  return { currentPassword: b.currentPassword, newPassword: password(b.newPassword, b.confirmPassword, "newPassword") };
}

export function parsePasswordReset(value: unknown): boolean {
  const b = fields(value, ["revokeApiTokens"]);
  if (b.revokeApiTokens !== undefined && typeof b.revokeApiTokens !== "boolean") {
    throw new AccountError("validation_error", "invalid_revoke_api_tokens", { field: "revokeApiTokens" });
  }
  return b.revokeApiTokens === true;
}

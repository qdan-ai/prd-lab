/** Only local paths survive authentication; reject URL parser normalization traps too. */
export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "/projects";
  let decoded = value;
  for (let i = 0; i < 4; i++) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return "/projects";
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return value;
      decoded = next;
    } catch { return "/projects"; }
  }
  return "/projects";
}

export function accountEntryUrl(path: "/login" | "/register", callback: unknown) {
  return `${path}?callbackUrl=${encodeURIComponent(safeCallbackUrl(callback))}`;
}

export function isProtectedAccountPath(path: string) {
  return ["/projects", "/settings", "/admin"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

import { errorResponse } from "@/lib/api/errors";

/** Share data and redirects must not survive a subsequent visibility or membership change. */
export async function shareResponse(run: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    const { AuthenticationUnavailableError } = await import("@/lib/auth/errors");
    if (!(error instanceof AuthenticationUnavailableError)) throw error;
    response = errorResponse("authentication_unavailable");
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** callback is assembled locally, never accepted as a user-supplied redirect destination. */
export function shareAccountLoginUrl(shareId: string, query = ""): string {
  return `/login?callbackUrl=${encodeURIComponent(`/share/${encodeURIComponent(shareId)}${query}`)}`;
}

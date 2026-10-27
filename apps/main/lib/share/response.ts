/** Share access is rechecked on every request (revocation, password change), so responses are never cached. */
export async function shareResponse(run: () => Promise<Response>): Promise<Response> {
  const response = await run();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

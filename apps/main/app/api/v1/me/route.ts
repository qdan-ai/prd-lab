import { getSession } from "@/lib/api/auth-guard";
import { errorResponse } from "@/lib/api/errors";

/** GET /api/v1/me —— 返当前登入用户（CLI whoami 用） */
export async function GET() {
  const session = await getSession();
  if (!session) return errorResponse("unauthorized");
  return Response.json({
    id: session.userId,
    name: session.userName,
    authVia: session.tokenId ? "api_token" : "session",
  });
}

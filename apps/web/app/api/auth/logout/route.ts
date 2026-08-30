import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie, sessionCookieName } from "../../../../lib/auth/cookies";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { revokeSessionByToken } from "../../../../lib/auth/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(sessionCookieName)?.value;
    if (token) {
      await revokeSessionByToken(token, "logout");
    }
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}

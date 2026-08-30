import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret } from "../../../../lib/auth/config";
import { verifyVerificationToken } from "../../../../lib/auth/crypto";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { AuthError } from "../../../../lib/auth/errors";
import { createSession, findUserById, markEmailVerified } from "../../../../lib/auth/repository";
import { getSessionContext } from "../../../../lib/auth/request";
import { safeRedirectPath } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verificationRedirect(request: NextRequest, status: string): NextResponse {
  const url = new URL("/verify-email", request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return verificationRedirect(request, "invalid");
    }

    const payload = verifyVerificationToken(token, getAuthSecret());
    if (!payload) {
      return verificationRedirect(request, "invalid");
    }

    const user = await findUserById(payload.userId);
    if (!user || user.email !== payload.email) {
      return verificationRedirect(request, "invalid");
    }
    if (user.emailVerified) {
      return verificationRedirect(request, "already-verified");
    }

    const verifiedUser = await markEmailVerified(user.id);
    if (!verifiedUser) {
      throw new AuthError("USER_NOT_FOUND", "This account no longer exists.", 404);
    }

    const session = await createSession(
      verifiedUser.id,
      getSessionContext(request),
      getAuthSecret(),
    );
    const destination = new URL(safeRedirectPath(payload.next), request.url);
    const response = NextResponse.redirect(destination);
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    console.error("[auth] verification failed", error);
    return verificationRedirect(request, "error");
  }
}

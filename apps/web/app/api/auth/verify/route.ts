import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret } from "../../../../lib/auth/config";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import {
  consumeEmailVerificationChallenge,
  createSession,
} from "../../../../lib/auth/repository";
import { getSessionContext } from "../../../../lib/auth/request";
import { getAuthenticatedDestination } from "../../../../lib/onboarding/service";
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

    const result = await consumeEmailVerificationChallenge(token);
    if (!result) {
      return verificationRedirect(request, "invalid");
    }
    if (result.alreadyVerified) {
      return verificationRedirect(request, "already-verified");
    }

    const secret = getAuthSecret();
    const session = await createSession(
      result.user.id,
      getSessionContext(request),
      secret,
    );
    const destinationPath = await getAuthenticatedDestination(
      result.user.id,
      safeRedirectPath(request.nextUrl.searchParams.get("next") ?? undefined),
    );
    const destination = new URL(destinationPath, request.url);
    const response = NextResponse.redirect(destination);
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    console.error("[auth] verification failed", error);
    return verificationRedirect(request, "error");
  }
}

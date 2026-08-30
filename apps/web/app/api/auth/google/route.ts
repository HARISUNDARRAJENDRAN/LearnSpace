import { NextResponse, type NextRequest } from "next/server";
import { getGoogleConfig, getGoogleOAuthEndpoints } from "../../../../lib/auth/config";
import { createOpaqueToken } from "../../../../lib/auth/crypto";
import { setOauthStateCookie } from "../../../../lib/auth/cookies";
import { AuthError, authErrorResponse } from "../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../lib/auth/rate-limit";
import { safeRedirectPath } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToLogin(request: NextRequest, error?: string): NextResponse {
  const url = new URL("/login", request.url);
  if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit({
      request,
      bucket: "google-initiation",
      limit: 10,
      windowSeconds: 10 * 60,
    });
    const google = getGoogleConfig(request);
    const endpoints = getGoogleOAuthEndpoints();
    const state = createOpaqueToken();
    const next = safeRedirectPath(request.nextUrl.searchParams.get("next") ?? undefined);
    const stateCookieValue = `${state}.${encodeURIComponent(next)}`;
    const authorizationUrl = new URL(endpoints.authorizationUrl);
    authorizationUrl.searchParams.set("client_id", google.clientId);
    authorizationUrl.searchParams.set("redirect_uri", google.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("prompt", "select_account");

    const response = NextResponse.redirect(authorizationUrl);
    setOauthStateCookie(response, stateCookieValue);
    return response;
  } catch (error) {
    if (error instanceof AuthError && error.status === 429) {
      return authErrorResponse(error);
    }
    return redirectToLogin(request, "google-unavailable");
  }
}

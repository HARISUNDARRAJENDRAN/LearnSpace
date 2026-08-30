import { NextResponse, type NextRequest } from "next/server";
import { getGoogleConfig } from "../../../../lib/auth/config";
import { createOpaqueToken } from "../../../../lib/auth/crypto";
import { setOauthStateCookie } from "../../../../lib/auth/cookies";
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
    const google = getGoogleConfig(request);
    const state = createOpaqueToken();
    const next = safeRedirectPath(request.nextUrl.searchParams.get("next") ?? undefined);
    const stateCookieValue = `${state}.${encodeURIComponent(next)}`;
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", google.clientId);
    authorizationUrl.searchParams.set("redirect_uri", google.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("prompt", "select_account");

    const response = NextResponse.redirect(authorizationUrl);
    setOauthStateCookie(response, stateCookieValue);
    return response;
  } catch {
    return redirectToLogin(request, "google-unavailable");
  }
}

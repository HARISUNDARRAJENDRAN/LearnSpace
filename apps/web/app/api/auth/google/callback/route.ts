import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getGoogleConfig, getAuthSecret } from "../../../../../lib/auth/config";
import {
  createSession,
  upsertGoogleUser,
} from "../../../../../lib/auth/repository";
import { getSessionContext } from "../../../../../lib/auth/request";
import {
  clearOauthStateCookie,
  oauthStateCookieName,
  setSessionCookie,
} from "../../../../../lib/auth/cookies";
import { safeEqualText } from "../../../../../lib/auth/crypto";
import { safeRedirectPath } from "../../../../../lib/auth/validation";

const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const googleProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().transform((value) => value.toLowerCase()),
  email_verified: z.boolean(),
  name: z.string().min(1).optional(),
  picture: z.string().url().optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loginRedirect(request: NextRequest, error?: string): NextResponse {
  const url = new URL("/login", request.url);
  if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url);
}

function clearState(response: NextResponse): NextResponse {
  clearOauthStateCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get(oauthStateCookieName)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!stateCookie || !state) {
    return clearState(loginRedirect(request, "google-invalid-callback"));
  }

  const separator = stateCookie.indexOf(".");
  if (separator < 1) {
    return clearState(loginRedirect(request, "google-invalid-callback"));
  }

  const expectedState = stateCookie.slice(0, separator);
  let next = "/app";
  try {
    next = safeRedirectPath(
      decodeURIComponent(stateCookie.slice(separator + 1)),
    );
  } catch {
    return clearState(loginRedirect(request, "google-invalid-callback"));
  }

  if (!safeEqualText(state, expectedState)) {
    return clearState(loginRedirect(request, "google-invalid-callback"));
  }

  if (request.nextUrl.searchParams.get("error")) {
    return clearState(loginRedirect(request, "google-cancelled"));
  }
  if (!code) {
    return clearState(loginRedirect(request, "google-invalid-callback"));
  }

  try {
    const google = getGoogleConfig(request);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: google.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error("Google token exchange failed");
    }
    const tokenData = googleTokenResponseSchema.parse(await tokenResponse.json());

    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (!profileResponse.ok) {
      throw new Error("Google profile request failed");
    }
    const profile = googleProfileSchema.parse(await profileResponse.json());
    if (!profile.email_verified) {
      return clearState(loginRedirect(request, "google-email-unverified"));
    }

    const googleUserInput: {
      providerAccountId: string;
      email: string;
      profile: Record<string, unknown>;
      displayName?: string;
      avatarUrl?: string;
    } = {
      providerAccountId: profile.sub,
      email: profile.email,
      profile: { ...profile },
    };
    if (profile.name) {
      googleUserInput.displayName = profile.name;
    }
    if (profile.picture) {
      googleUserInput.avatarUrl = profile.picture;
    }

    const user = await upsertGoogleUser(googleUserInput);
    const session = await createSession(
      user.id,
      getSessionContext(request),
      getAuthSecret(),
    );
    const response = NextResponse.redirect(new URL(next, request.url));
    setSessionCookie(response, session.token, session.maxAge);
    clearOauthStateCookie(response);
    return response;
  } catch (error) {
    console.error("[auth] Google callback failed", error);
    return clearState(loginRedirect(request, "google-failed"));
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  getGoogleConfig,
  getGoogleOAuthEndpoints,
  getAuthSecret,
  getAppBaseUrl,
} from "../../../../../lib/auth/config";
import {
  createSession,
  upsertGoogleUser,
} from "../../../../../lib/auth/repository";
import { getSessionContext } from "../../../../../lib/auth/request";
import { getAuthenticatedDestination } from "../../../../../lib/onboarding/service";
import {
  clearDesktopOauthFlowCookie,
  clearOauthStateCookie,
  desktopOauthFlowCookieName,
  oauthStateCookieName,
  setSessionCookie,
} from "../../../../../lib/auth/cookies";
import { safeEqualText } from "../../../../../lib/auth/crypto";
import {
  validDesktopFlowId,
  writeDesktopAuthHandoff,
} from "../../../../../lib/auth/desktop-handoff";
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
  const url = new URL("/login", getAppBaseUrl(request));
  if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url);
}

function clearState(response: NextResponse): NextResponse {
  clearOauthStateCookie(response);
  clearDesktopOauthFlowCookie(response);
  return response;
}

function desktopAuthResponse(
  flowId: string,
  code: string,
): NextResponse {
  const url = new URL("learnspace://google-oauth");
  url.searchParams.set("flow", flowId);
  url.searchParams.set("code", code);
  return clearState(new NextResponse(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
    },
  }));
}

async function failureResponse(
  request: NextRequest,
  desktopFlow: string | undefined,
  code: string,
  stateValidated = false,
): Promise<NextResponse> {
  if (desktopFlow && stateValidated) {
    try {
      const handoffCode = await writeDesktopAuthHandoff(desktopFlow, {
        status: "error",
        message: code === "google-cancelled" ? "Google sign-in was cancelled." : "Google sign-in failed. Please try again.",
      });
      if (handoffCode) return desktopAuthResponse(desktopFlow, handoffCode);
    } catch (error) {
      console.error("[auth] Desktop sign-in handoff failed", error);
    }
    return clearState(new NextResponse("Google sign-in failed. Please return to LearnSpace.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }));
  }
  return clearState(loginRedirect(request, code));
}

export async function GET(request: NextRequest) {
  const stateCookie = request.cookies.get(oauthStateCookieName)?.value;
  const desktopFlowCookie = request.cookies.get(desktopOauthFlowCookieName)?.value;
  const desktopFlow = validDesktopFlowId(desktopFlowCookie) ? desktopFlowCookie : undefined;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!stateCookie || !state) {
    return failureResponse(request, desktopFlow, "google-invalid-callback");
  }

  const separator = stateCookie.indexOf(".");
  if (separator < 1) {
    return failureResponse(request, desktopFlow, "google-invalid-callback");
  }

  const expectedState = stateCookie.slice(0, separator);
  let next = "/app";
  try {
    next = safeRedirectPath(
      decodeURIComponent(stateCookie.slice(separator + 1)),
    );
  } catch {
    return failureResponse(request, desktopFlow, "google-invalid-callback");
  }

  if (!safeEqualText(state, expectedState)) {
    return failureResponse(request, desktopFlow, "google-invalid-callback");
  }

  if (request.nextUrl.searchParams.get("error")) {
    return failureResponse(request, desktopFlow, "google-cancelled", true);
  }
  if (!code) {
    return failureResponse(request, desktopFlow, "google-invalid-callback", true);
  }

  try {
    const google = getGoogleConfig(request);
    const endpoints = getGoogleOAuthEndpoints();
    const tokenResponse = await fetch(endpoints.tokenUrl, {
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

    const profileResponse = await fetch(endpoints.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileResponse.ok) {
      throw new Error("Google profile request failed");
    }
    const profile = googleProfileSchema.parse(await profileResponse.json());
    if (!profile.email_verified) {
      return failureResponse(request, desktopFlow, "google-email-unverified", true);
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
    const destination = await getAuthenticatedDestination(user.id, next);
    if (desktopFlow) {
      const code = await writeDesktopAuthHandoff(desktopFlow, {
        status: "success",
        token: session.token,
        maxAge: session.maxAge,
        destination,
      });
      if (!code) throw new Error("Desktop sign-in handoff was not stored.");
      return desktopAuthResponse(desktopFlow, code);
    }
    const response = NextResponse.redirect(new URL(destination, getAppBaseUrl(request)));
    setSessionCookie(response, session.token, session.maxAge);
    clearOauthStateCookie(response);
    clearDesktopOauthFlowCookie(response);
    return response;
  } catch (error) {
    console.error("[auth] Google callback failed", error);
    return failureResponse(request, desktopFlow, "google-failed", true);
  }
}

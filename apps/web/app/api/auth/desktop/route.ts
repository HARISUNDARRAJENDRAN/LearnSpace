import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl, getAuthSecret } from "../../../../lib/auth/config";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { openDesktopHandoff } from "../../../../lib/auth/desktop-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The desktop app opens this with the code from its learnspace:// link to
// receive the session its system-browser Google sign-in created.
export function GET(request: NextRequest) {
  const appUrl = getAppBaseUrl(request);
  try {
    const handoff = openDesktopHandoff(request.nextUrl.searchParams.get("code") ?? "", getAuthSecret());
    if (handoff) {
      const response = NextResponse.redirect(new URL(handoff.destination, appUrl));
      setSessionCookie(response, handoff.token, handoff.maxAge);
      return response;
    }
  } catch (error) {
    console.error("[auth] Desktop sign-in handoff failed", error);
  }
  return NextResponse.redirect(new URL("/login?error=google-failed", appUrl));
}

import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "./lib/auth/config";

const sessionCookieName = "learnspace_session";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(sessionCookieName)) {
    const loginUrl = new URL("/login", getAppBaseUrl(request));
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-learnspace-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*"],
};

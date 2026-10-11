import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl } from "./lib/auth/config";

const sessionCookieName = "learnspace_session";

export function proxy(request: NextRequest) {
  const testMode = process.env.AUTH_TEST_MODE === "true";
  const pathname = request.nextUrl.pathname;
  const isDesktop = request.headers.get("x-learnspace-desktop") === "1";
  const desktopFlow = request.nextUrl.searchParams.get("desktop_flow");
  const isBrowserOauth = pathname === "/api/auth/google/callback" || (
    pathname === "/api/auth/google" &&
    desktopFlow !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(desktopFlow)
  );

  if (!testMode && !isDesktop && !isBrowserOauth) {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (
    (pathname === "/app" || pathname.startsWith("/app/") ||
      pathname === "/onboarding" || pathname.startsWith("/onboarding/")) &&
    !request.cookies.has(sessionCookieName)
  ) {
    const loginUrl = new URL("/login", getAppBaseUrl(request));
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-learnspace-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/app/:path*",
    "/onboarding/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/api/auth/:path*",
    "/api/onboarding/:path*",
    "/api/v1/:path*",
  ],
};

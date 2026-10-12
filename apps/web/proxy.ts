import { type NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "./lib/auth/config";

const sessionCookieName = "learnspace_session";
const desktopHandoffPostPath = /^\/api\/auth\/desktop\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/complete)?$/i;

function hasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === getAppBaseUrl(request);
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/api/") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    !desktopHandoffPostPath.test(pathname) &&
    !hasSameOrigin(request)
  ) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
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

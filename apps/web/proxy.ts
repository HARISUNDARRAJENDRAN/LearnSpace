import { NextResponse, type NextRequest } from "next/server";

const sessionCookieName = "learnspace_session";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(sessionCookieName)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};

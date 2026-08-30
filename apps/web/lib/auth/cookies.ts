import type { NextResponse } from "next/server";

export const sessionCookieName = "learnspace_session";
export const oauthStateCookieName = "learnspace_oauth_state";
const secureCookies = process.env.NODE_ENV === "production";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setSessionCookie(response: NextResponse, token: string, maxAge: number): void {
  response.cookies.set({
    name: sessionCookieName,
    value: token,
    ...cookieOptions(maxAge),
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: sessionCookieName,
    value: "",
    ...cookieOptions(0),
  });
}

export function setOauthStateCookie(response: NextResponse, value: string): void {
  response.cookies.set({
    name: oauthStateCookieName,
    value,
    ...cookieOptions(600),
  });
}

export function clearOauthStateCookie(response: NextResponse): void {
  response.cookies.set({
    name: oauthStateCookieName,
    value: "",
    ...cookieOptions(0),
  });
}

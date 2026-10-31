// URL policy for the desktop window: which pages stay in the app, which open
// in the system browser, and how browser-based Google sign-in returns.

export const appProtocol = "learnspace";
const defaultAppUrl = "https://learn-space.app";

export function appOrigin(value: string | undefined): string {
  const url = new URL(value || defaultAppUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("LEARNSPACE_URL must use HTTPS, or HTTP on localhost.");
  }
  return url.origin;
}

function parse(target: string): URL | null {
  try {
    return new URL(target);
  } catch {
    return null;
  }
}

export function isAppUrl(target: string, origin: string): boolean {
  return parse(target)?.origin === origin;
}

// Only web and mail links leave the app; file:, javascript: and other schemes are dropped.
export function externalUrl(target: string): string | null {
  const url = parse(target);
  return url && ["https:", "http:", "mailto:"].includes(url.protocol) ? url.toString() : null;
}

// Google refuses OAuth in embedded windows, so its sign-in runs in the system browser.
export function googleSignInUrl(target: string, origin: string, nonce: string): string | null {
  const url = parse(target);
  if (url?.origin !== origin || url.pathname !== "/api/auth/google") return null;
  url.searchParams.set("desktop", nonce);
  return url.toString();
}

// Accepts only the learnspace://auth link answering the sign-in this app started.
export function handoffUrl(link: string, origin: string, nonce: string | undefined): string | null {
  const url = parse(link);
  const code = url?.searchParams.get("code");
  if (url?.protocol !== `${appProtocol}:` || url.host !== "auth" || !code) return null;
  if (!nonce || url.searchParams.get("state") !== nonce) return null;
  const exchange = new URL("/api/auth/desktop", origin);
  exchange.searchParams.set("code", code);
  return exchange.toString();
}

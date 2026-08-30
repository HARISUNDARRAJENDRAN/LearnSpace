import { AuthError } from "./errors";

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || secret === "replace-with-a-random-32-byte-secret") {
    throw new AuthError(
      "AUTH_NOT_CONFIGURED",
      "Authentication is not configured on this server.",
      503,
    );
  }

  return secret;
}

export function getAppBaseUrl(request?: Request): string {
  const configuredUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  try {
    if (configuredUrl) {
      return new URL(configuredUrl).origin;
    }

    if (request) {
      return new URL(request.url).origin;
    }
  } catch {
    throw new AuthError("APP_URL_INVALID", "The application URL is invalid.", 503);
  }

  throw new AuthError("APP_URL_NOT_CONFIGURED", "The application URL is not configured.", 503);
}

export function getGoogleConfig(request: Request): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new AuthError(
      "GOOGLE_NOT_CONFIGURED",
      "Google sign-in is not configured on this server.",
      503,
    );
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    getAppBaseUrl(request) + "/api/auth/google/callback";

  return { clientId, clientSecret, redirectUri };
}

export function assertEmailDeliveryConfigured(): void {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  ) {
    throw new AuthError(
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured on this server.",
      503,
    );
  }
}

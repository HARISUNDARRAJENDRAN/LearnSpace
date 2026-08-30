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
  const configuredUrl = process.env.APP_URL;

  if (!configuredUrl && process.env.NODE_ENV === "production") {
    throw new AuthError(
      "APP_URL_NOT_CONFIGURED",
      "The application URL is not configured.",
      503,
    );
  }

  try {
    if (configuredUrl) {
      const parsed = new URL(configuredUrl);
      if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
        throw new AuthError(
          "APP_URL_INVALID",
          "The application URL must use HTTPS in production.",
          503,
        );
      }
      return parsed.origin;
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

  const redirectUri = process.env.GOOGLE_REDIRECT_URI ??
    getAppBaseUrl(request) + "/api/auth/google/callback";

  try {
    const parsedRedirectUri = new URL(redirectUri);
    if (process.env.NODE_ENV === "production" && parsedRedirectUri.protocol !== "https:") {
      throw new AuthError(
        "GOOGLE_REDIRECT_URI_INVALID",
        "The Google redirect URL must use HTTPS in production.",
        503,
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError(
      "GOOGLE_REDIRECT_URI_INVALID",
      "The Google redirect URL is invalid.",
      503,
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export function getGoogleOAuthEndpoints(): {
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
} {
  const testMode = process.env.NODE_ENV !== "production" && process.env.AUTH_TEST_MODE === "true";
  const endpoint = (name: string, fallback: string): string => {
    if (!testMode || !process.env[name]) {
      return fallback;
    }
    try {
      return new URL(process.env[name]).toString();
    } catch {
      throw new AuthError("GOOGLE_ENDPOINT_INVALID", "The Google OAuth endpoint is invalid.", 503);
    }
  };

  return {
    authorizationUrl: endpoint(
      "AUTH_TEST_GOOGLE_AUTHORIZATION_URL",
      "https://accounts.google.com/o/oauth2/v2/auth",
    ),
    tokenUrl: endpoint(
      "AUTH_TEST_GOOGLE_TOKEN_URL",
      "https://oauth2.googleapis.com/token",
    ),
    userInfoUrl: endpoint(
      "AUTH_TEST_GOOGLE_USERINFO_URL",
      "https://openidconnect.googleapis.com/v1/userinfo",
    ),
  };
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

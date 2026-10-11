import { getAppBaseUrl } from "./config";

function actionUrl(request: Request, desktopHost: string, webPath: string): URL {
  const useDesktopProtocol =
    process.env.NODE_ENV === "production" &&
    process.env.AUTH_TEST_MODE !== "true" &&
    request.headers.get("x-learnspace-desktop") === "1";
  return useDesktopProtocol
    ? new URL(`learnspace://${desktopHost}`)
    : new URL(webPath, getAppBaseUrl(request));
}

export function verificationActionUrl(request: Request, token: string, next: string): URL {
  const url = actionUrl(request, "verify-email", "/api/auth/verify");
  url.searchParams.set("token", token);
  url.searchParams.set("next", next);
  return url;
}

export function passwordResetActionUrl(request: Request, token: string): URL {
  const url = actionUrl(request, "reset-password", "/reset-password");
  url.searchParams.set("token", token);
  return url;
}

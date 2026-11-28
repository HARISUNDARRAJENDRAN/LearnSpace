import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use 128 characters or fewer.");

export const registerInputSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: passwordSchema,
  next: z.string().optional(),
});

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: passwordSchema,
  next: z.string().optional(),
});

export const resendVerificationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  next: z.string().optional(),
});

export const forgotPasswordInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
});

export const resetPasswordInputSchema = z.object({
  token: z.string().trim().min(1, "This reset link is invalid.").max(512),
  password: passwordSchema,
});

const sharedFolderPathPattern = /^\/share\/[A-Za-z0-9_-]{32,128}$/;

export function isSharedFolderPath(pathname: string): boolean {
  return sharedFolderPathPattern.test(pathname);
}

export function safeRedirectPath(value: string | undefined, fallback = "/app"): string {
  if (
    !value ||
    value.includes("\\") ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/api")
  ) {
    return fallback;
  }

  const target = new URL(value, "http://localhost");
  const pathname = target.pathname;
  if (target.origin !== "http://localhost") {
    return fallback;
  }

  if (isSharedFolderPath(pathname)) {
    if (target.search || target.hash) return fallback;
    return pathname;
  }

  if (pathname !== "/onboarding" && pathname !== "/app" && !pathname.startsWith("/app/")) {
    return fallback;
  }

  return target.pathname + target.search + target.hash;
}

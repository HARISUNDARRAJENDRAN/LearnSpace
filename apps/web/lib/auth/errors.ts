import { z } from "zod";

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, retryAfterSeconds?: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
}

function responseInit(error: AuthError): ResponseInit {
  return {
    status: error.status,
    ...(error.retryAfterSeconds !== undefined
      ? { headers: { "Retry-After": String(error.retryAfterSeconds) } }
      : {}),
  };
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json(
      { error: { code: error.code, message: error.message, ...error.details } },
      responseInit(error),
    );
  }

  if (error instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the highlighted fields and try again.",
        },
        fields: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  console.error("[auth] unexpected error", error);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === "23505";
}

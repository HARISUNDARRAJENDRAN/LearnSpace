import assert from "node:assert/strict";
import test from "node:test";
import { createOpaqueToken, hashToken, hashPassword, verifyPassword } from "../lib/auth/crypto";
import { getAppBaseUrl, getGoogleConfig } from "../lib/auth/config";
import { AuthError } from "../lib/auth/errors";
import { enforceRateLimit } from "../lib/auth/rate-limit";
import { getClientIp, readJson } from "../lib/auth/request";
import { safeRedirectPath } from "../lib/auth/validation";

const secret = "test-auth-secret-that-is-long-enough-for-hmac";
const mutableEnv = process.env as Record<string, string | undefined>;

test("password hashes verify only for the original password", async () => {
  const hash = await hashPassword("correct horse battery staple");

  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.notEqual(hash, "correct horse battery staple");
});

test("opaque challenge tokens are persisted only as hashes", () => {
  const token = createOpaqueToken();

  assert.notEqual(token, hashToken(token));
  assert.equal(hashToken(token), hashToken(token));
  assert.equal(token.length >= 40, true);
});

test("redirect targets remain local application paths", () => {
  assert.equal(safeRedirectPath("/app?tab=review"), "/app?tab=review");
  assert.equal(safeRedirectPath("https://example.com"), "/app");
  assert.equal(safeRedirectPath("//example.com"), "/app");
  assert.equal(safeRedirectPath("/\\\\example.com"), "/app");
  assert.equal(safeRedirectPath("/api/auth/session"), "/app");
  assert.equal(safeRedirectPath("/login?next=/register"), "/app");
  assert.equal(safeRedirectPath("/register"), "/app");
  assert.equal(safeRedirectPath("/app/../login"), "/app");
  assert.equal(safeRedirectPath("/\t/example.com/app"), "/app");
  assert.equal(safeRedirectPath("/app/./discover"), "/app/discover");
  assert.equal(safeRedirectPath("/onboarding"), "/onboarding");
});

test("Google's callback must share the public application origin", () => {
  const keys = ["APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.APP_URL = "https://learnspace.example";
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://learnspace.example/api/auth/google/callback";
    const request = new Request("http://0.0.0.0:3000/api/auth/google");
    assert.equal(getGoogleConfig(request).redirectUri, process.env.GOOGLE_REDIRECT_URI);
    process.env.GOOGLE_REDIRECT_URI = "https://other.example/api/auth/google/callback";
    assert.throws(() => getGoogleConfig(request), (error: unknown) =>
      error instanceof AuthError && error.code === "GOOGLE_REDIRECT_URI_INVALID");
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("malformed JSON is reported as a client error", async () => {
  await assert.rejects(
    () => readJson(new Request("http://localhost", { method: "POST", body: "{" })),
    { code: "INVALID_JSON", status: 400 },
  );
});

test("Vercel rate-limit identity prefers the trusted forwarded client IP", () => {
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";

  try {
    const request = new Request("https://learnspace.example", {
      headers: {
        "x-real-ip": "spoofed-value",
        "x-vercel-forwarded-for": "trusted-value",
        "x-forwarded-for": "untrusted-value",
      },
    });
    assert.equal(getClientIp(request), "trusted-value");
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("rate limiting returns a retryable 429", async () => {
  const previous = {
    authSecret: process.env.AUTH_SECRET,
    backend: process.env.AUTH_RATE_LIMIT_BACKEND,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.AUTH_SECRET = secret;
  process.env.AUTH_RATE_LIMIT_BACKEND = "memory";
  mutableEnv.NODE_ENV = "test";

  try {
    const request = new Request("http://localhost", {
      headers: { "x-real-ip": "unit-test-rate-limit" },
    });
    const bucket = `unit-${createOpaqueToken()}`;
    await enforceRateLimit({
      request,
      bucket,
      limit: 1,
      windowSeconds: 60,
    });
    await assert.rejects(
      () =>
        enforceRateLimit({
          request,
          bucket,
          limit: 1,
          windowSeconds: 60,
        }),
      (error: unknown) =>
        error instanceof AuthError && error.status === 429 && error.retryAfterSeconds === 60,
    );
  } finally {
    if (previous.authSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous.authSecret;
    if (previous.backend === undefined) delete process.env.AUTH_RATE_LIMIT_BACKEND;
    else process.env.AUTH_RATE_LIMIT_BACKEND = previous.backend;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("production auth URLs require an HTTPS APP_URL", () => {
  const previous = { appUrl: process.env.APP_URL, nodeEnv: process.env.NODE_ENV };
  mutableEnv.NODE_ENV = "production";

  try {
    delete process.env.APP_URL;
    assert.throws(() => getAppBaseUrl(), (error: unknown) =>
      error instanceof AuthError && error.code === "APP_URL_NOT_CONFIGURED");

    process.env.APP_URL = "http://learnspace.example";
    assert.throws(() => getAppBaseUrl(), (error: unknown) =>
      error instanceof AuthError && error.code === "APP_URL_INVALID");

    process.env.APP_URL = "https://learnspace.example";
    assert.equal(getAppBaseUrl(), "https://learnspace.example");
  } finally {
    if (previous.appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous.appUrl;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

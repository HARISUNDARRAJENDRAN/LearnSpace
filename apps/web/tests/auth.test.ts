import assert from "node:assert/strict";
import test from "node:test";
import {
  createVerificationToken,
  hashPassword,
  verifyPassword,
  verifyVerificationToken,
} from "../lib/auth/crypto";
import { safeRedirectPath } from "../lib/auth/validation";
import { readJson } from "../lib/auth/request";

const secret = "test-auth-secret-that-is-long-enough-for-hmac";

test("password hashes verify only for the original password", async () => {
  const hash = await hashPassword("correct horse battery staple");

  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.notEqual(hash, "correct horse battery staple");
});

test("verification tokens are signed and expire", () => {
  const token = createVerificationToken(
    {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "learner@example.com",
      next: "/app",
      exp: Date.now() + 60_000,
    },
    secret,
  );

  assert.equal(verifyVerificationToken(token, secret)?.email, "learner@example.com");
  assert.equal(verifyVerificationToken(`${token}tampered`, secret), null);

  const expired = createVerificationToken(
    {
      userId: "11111111-1111-4111-8111-111111111111",
      email: "learner@example.com",
      next: "/app",
      exp: Date.now() - 1,
    },
    secret,
  );
  assert.equal(verifyVerificationToken(expired, secret), null);
});

test("redirect targets remain local application paths", () => {
  assert.equal(safeRedirectPath("/app?tab=review"), "/app?tab=review");
  assert.equal(safeRedirectPath("https://example.com"), "/app");
  assert.equal(safeRedirectPath("//example.com"), "/app");
  assert.equal(safeRedirectPath("/\\\\example.com"), "/app");
  assert.equal(safeRedirectPath("/api/auth/session"), "/app");
});

test("malformed JSON is reported as a client error", async () => {
  await assert.rejects(
    () => readJson(new Request("http://localhost", { method: "POST", body: "{" })),
    { code: "INVALID_JSON", status: 400 },
  );
});

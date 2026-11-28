import assert from "node:assert/strict";
import test from "node:test";
import { folderShareMutationSchema, folderShareTokenSchema } from "@learnspace/shared";
import { createOpaqueToken } from "../lib/auth/crypto";
import { AuthError } from "../lib/auth/errors";
import { assertSameOrigin, decryptShareToken, encryptShareToken, isValidShareToken } from "../lib/folders/share";

const testSecret = "folder-share-unit-test-secret-with-32-plus-bytes";

test("share token encryption uses authenticated AES-GCM and rejects tampering", () => {
  const token = createOpaqueToken();
  const first = encryptShareToken(token, testSecret);
  const second = encryptShareToken(token, testSecret);

  assert.notEqual(first, token);
  assert.notEqual(first, second, "fresh random IV should produce distinct ciphertexts");
  assert.equal(decryptShareToken(first, testSecret), token);
  assert.equal(decryptShareToken(second, testSecret), token);

  const tampered = `${first.slice(0, -2)}${first.endsWith("AA") ? "BB" : "AA"}`;
  assert.throws(() => decryptShareToken(tampered, testSecret));
  assert.throws(() => decryptShareToken(first, "different-secret-that-is-also-32-bytes-long"));
  assert.throws(() => decryptShareToken("v2.bad.format.here", testSecret));
});

test("share token and mutation schemas enforce strict bounds", () => {
  const validToken = createOpaqueToken();
  assert.equal(isValidShareToken(validToken), true);
  assert.equal(folderShareTokenSchema.safeParse(validToken).success, true);

  assert.equal(isValidShareToken("short"), false);
  assert.equal(isValidShareToken(`${"a".repeat(32)}/evil`), false);
  assert.equal(isValidShareToken(`${"a".repeat(32)}?x=1`), false);
  assert.equal(isValidShareToken("a".repeat(129)), false);

  assert.deepEqual(folderShareMutationSchema.parse({}), { rotate: false });
  assert.deepEqual(folderShareMutationSchema.parse({ rotate: true }), { rotate: true });
  assert.equal(folderShareMutationSchema.safeParse({ rotate: false, extra: 1 }).success, false);
});

test("assertSameOrigin blocks cross-site CSRF requests and allows same-origin requests", () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://learn-space.app";
  try {
    assert.doesNotThrow(() =>
      assertSameOrigin(new Request("https://learn-space.app/api/v1/shared-folders/abc/import", {
        method: "POST",
        headers: { origin: "https://learn-space.app" },
      })),
    );
    assert.doesNotThrow(() =>
      assertSameOrigin(new Request("https://learn-space.app/api/v1/shared-folders/abc/import", {
        method: "POST",
        headers: { referer: "https://learn-space.app/share/token" },
      })),
    );
    assert.throws(
      () =>
        assertSameOrigin(new Request("https://learn-space.app/api/v1/shared-folders/abc/import", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        })),
      (error: unknown) => error instanceof AuthError && error.code === "INVALID_ORIGIN" && error.status === 403,
    );
    assert.throws(
      () =>
        assertSameOrigin(new Request("https://learn-space.app/api/v1/shared-folders/abc/import", {
          method: "POST",
          headers: { referer: "https://evil.example/phish" },
        })),
      (error: unknown) => error instanceof AuthError && error.code === "INVALID_ORIGIN" && error.status === 403,
    );
    assert.throws(
      () =>
        assertSameOrigin(new Request("https://learn-space.app/api/v1/shared-folders/abc/import", {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site" },
        })),
      (error: unknown) => error instanceof AuthError && error.code === "INVALID_ORIGIN" && error.status === 403,
    );
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { appOrigin, externalUrl, googleSignInUrl, handoffUrl, isAppUrl } from "./links.js";

const origin = "https://learnspace.example";

test("the app origin must be HTTPS except on localhost", () => {
  assert.equal(appOrigin(undefined), "https://learnspace-staging.vercel.app");
  assert.equal(appOrigin("https://learnspace.example/app?x=1"), origin);
  assert.equal(appOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.throws(() => appOrigin("http://learnspace.example"));
  assert.throws(() => appOrigin("file:///etc/passwd"));
});

test("only same-origin pages stay in the window", () => {
  assert.equal(isAppUrl(`${origin}/app`, origin), true);
  assert.equal(isAppUrl("https://learnspace.example.evil.test/app", origin), false);
  assert.equal(isAppUrl("not a url", origin), false);
  assert.equal(externalUrl("https://youtube.com/watch?v=1"), "https://youtube.com/watch?v=1");
  assert.equal(externalUrl("mailto:help@learnspace.example"), "mailto:help@learnspace.example");
  assert.equal(externalUrl("file:///etc/passwd"), null);
  assert.equal(externalUrl("javascript:alert(1)"), null);
});

test("Google sign-in moves to the browser carrying the desktop nonce", () => {
  assert.equal(
    googleSignInUrl(`${origin}/api/auth/google?next=%2Fapp`, origin, "nonce"),
    `${origin}/api/auth/google?next=%2Fapp&desktop=nonce`,
  );
  assert.equal(googleSignInUrl(`${origin}/api/auth/login`, origin, "nonce"), null);
  assert.equal(googleSignInUrl("https://other.example/api/auth/google", origin, "nonce"), null);
});

test("sign-in links are accepted only for the pending nonce", () => {
  const link = "learnspace://auth?code=sealed-code&state=nonce";
  assert.equal(handoffUrl(link, origin, "nonce"), `${origin}/api/auth/desktop?code=sealed-code`);
  assert.equal(handoffUrl(link, origin, "other"), null);
  assert.equal(handoffUrl(link, origin, undefined), null);
  assert.equal(handoffUrl("learnspace://auth?state=nonce", origin, "nonce"), null);
  assert.equal(handoffUrl("learnspace://elsewhere?code=c&state=nonce", origin, "nonce"), null);
  assert.equal(handoffUrl("https://auth?code=c&state=nonce", origin, "nonce"), null);
});

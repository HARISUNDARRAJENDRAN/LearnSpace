import { expect, test } from "@playwright/test";

const email = process.env.PLAYWRIGHT_E2E_EMAIL ?? "browser-e2e@example.test";
const googleEmail = process.env.AUTH_TEST_GOOGLE_EMAIL ?? "google-e2e@example.test";
const password = "browser-password-123";

test.describe.configure({ mode: "serial" });

test("register, verify, log in, access the app, and log out", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Browser Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  const verificationLink = page.getByRole("link", { name: "Open verification link" });
  await expect(verificationLink).toBeVisible();
  const verificationHref = await verificationLink.getAttribute("href");
  await verificationLink.click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.waitForLoadState("load");

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app/);

  if (!verificationHref) {
    throw new Error("The development verification URL was not rendered");
  }
  await page.goto(verificationHref);
  await expect(page).toHaveURL(/\/verify-email\?status=invalid/);
});

test("forgot and reset password revoke the old session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app/);
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  const resetLink = page.getByRole("link", { name: "Open password reset link" });
  await expect(resetLink).toBeVisible();
  await resetLink.click();
  await page.waitForLoadState("load");
  await page.getByLabel("New password", { exact: true }).fill("browser-password-456");
  await page.getByLabel("Confirm password").fill("browser-password-456");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("region", { name: "Welcome back." }).getByRole("alert")).toContainText("incorrect");

  await page.getByLabel("Password", { exact: true }).fill("browser-password-456");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app/);
});

test("Google takeover clears the unverified password credential", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Unverified Owner");
  await page.getByLabel("Email address").fill(googleEmail);
  await page.getByLabel("Password", { exact: true }).fill("attacker-password-789");
  await page.getByLabel("Confirm password").fill("attacker-password-789");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  await page.goto("/login");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/app/);
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto("/login");
  await page.getByLabel("Email address").fill(googleEmail);
  await page.getByLabel("Password", { exact: true }).fill("attacker-password-789");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("region", { name: "Welcome back." }).getByRole("alert")).toContainText("incorrect");
});

test("auth login rate limit returns HTTP 429", async ({ request }) => {
  const limitedEmail = `rate-${Date.now()}@example.test`;
  const rateIp = `e2e-rate-${Date.now()}`;
  let lastResponse = await request.post("/api/auth/login", {
    headers: { "x-real-ip": rateIp },
    data: { email: limitedEmail, password: "wrong-password" },
  });
  for (let attempt = 1; attempt < 9; attempt += 1) {
    lastResponse = await request.post("/api/auth/login", {
      headers: { "x-real-ip": rateIp },
      data: { email: limitedEmail, password: "wrong-password" },
    });
  }
  expect(lastResponse.status()).toBe(429);
  expect(lastResponse.headers()["retry-after"]).toBeTruthy();
});

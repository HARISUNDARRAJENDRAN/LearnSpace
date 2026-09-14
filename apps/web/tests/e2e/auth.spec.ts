import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

const baseEmail = process.env.PLAYWRIGHT_E2E_EMAIL ?? "browser-e2e@example.test";
const googleEmail = process.env.AUTH_TEST_GOOGLE_EMAIL ?? "google-e2e@example.test";
const password = "browser-password-123";

function uniqueEmail(label: string): string {
  const [localPart, domain = "example.test"] = baseEmail.split("@");
  return `${localPart}-${label}-${randomUUID().slice(0, 8)}@${domain}`;
}

async function registerAndVerify(
  page: Page,
  email: string,
  userPassword: string,
  displayName: string,
): Promise<string> {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(displayName);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(userPassword);
  await page.getByLabel("Confirm password").fill(userPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  const verificationLink = page.getByRole("link", { name: "Open verification link" });
  await expect(verificationLink).toBeVisible();
  const verificationHref = await verificationLink.getAttribute("href");
  if (!verificationHref) throw new Error("The development verification URL was not rendered");
  await verificationLink.click();
  await expect(page).toHaveURL(/\/onboarding/);
  return verificationHref;
}

async function completeOnboarding(page: Page, refreshDraft = false) {
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.locator("[data-onboarding-hydrated]")).toHaveAttribute(
    "data-onboarding-hydrated",
    "true",
  );
  await page.getByRole("button", { name: "Get started" }).click();
  const personaDraftSaved = refreshDraft
    ? page.waitForResponse((response) => {
        const request = response.request();
        return (
          response.url().endsWith("/api/onboarding") &&
          request.method() === "PATCH" &&
          response.status() === 200 &&
          request.postData()?.includes('"persona":"student"') === true
        );
      })
    : null;
  await page.getByRole("button", { name: "Student" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  if (refreshDraft) {
    await personaDraftSaved;
    await page.reload();
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("button", { name: "Student" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Coursework" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByPlaceholder("Search topics, skills, or domains")).toBeVisible();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("LLM");
  await expect(page.getByRole("button", { name: /Large Language Models/ })).toBeVisible();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("AI");
  await page.getByRole("button", { name: /AI \/ Machine Learning/ }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("Python");
  await page.getByRole("button", { name: "Python skill" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("React");
  await page.getByRole("button", { name: "React skill" }).click();
  await expect(page.getByText("3 selected · minimum 3")).toBeVisible();
  const interestsDraftSaved = refreshDraft
    ? page.waitForResponse((response) => {
        const request = response.request();
        return (
          response.url().endsWith("/api/onboarding") &&
          request.method() === "PATCH" &&
          response.status() === 200 &&
          request.postData()?.includes('"conceptIds"') === true
        );
      })
    : null;
  await page.getByRole("button", { name: "Continue" }).click();
  if (refreshDraft) await interestsDraftSaved;
  if (refreshDraft) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await expect(page.locator("[data-onboarding-hydrated]")).toHaveAttribute(
      "data-onboarding-hydrated",
      "true",
    );
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: "Student" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: "Coursework" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("button.onboarding-chip.is-selected").filter({ hasText: "AI / Machine Learning" })).toBeVisible();
    await expect(page.locator("button.onboarding-chip.is-selected").filter({ hasText: "Python" })).toBeVisible();
    await expect(page.locator("button.onboarding-chip.is-selected").filter({ hasText: "React" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Clear explanations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Start learning" })).toBeDisabled();
  await page.getByRole("button", { name: "Just getting started" }).click();
  await page.getByRole("button", { name: "I know the basics" }).click();
  await page.getByRole("button", { name: "I'm fairly comfortable" }).click();
  await page.getByRole("button", { name: "It depends on the topic" }).click();
  await page.getByRole("button", { name: "I'm advanced" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function isolateClientIp(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-${randomUUID()}` });
}

async function clearGoogleTestUser(): Promise<void> {
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) return;
  const database = postgres(databaseUrl, { max: 1 });
  try {
    const users = await database<{ id: string }[]>`SELECT id FROM identity.users WHERE lower(email) = lower(${googleEmail})`;
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      await database`DELETE FROM discovery.discovery_interactions WHERE user_id IN ${database(userIds)}`;
      await database`DELETE FROM discovery.recommendation_impressions WHERE user_id IN ${database(userIds)}`;
      await database`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id IN ${database(userIds)})`;
      await database`DELETE FROM discovery.recommendation_runs WHERE user_id IN ${database(userIds)}`;
      await database`DELETE FROM ops.outbox_events WHERE user_id IN ${database(userIds)}`;
      await database`DELETE FROM ops.idempotency_records WHERE user_id IN ${database(userIds)}`;
      await database`DELETE FROM activity.activity_events WHERE user_id IN ${database(userIds)}`;
    }
    await database`DELETE FROM identity.users WHERE lower(email) = lower(${googleEmail})`;
  } finally {
    await database.end({ timeout: 5 });
  }
}

async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  const logoutButton = page.getByRole("menu").getByRole("menuitem", { name: "Log out" });
  await expect(logoutButton).toBeVisible();
  await logoutButton.click();
  await expect(page).toHaveURL("/");
}

test("register, verify, log in, access the app, and log out", async ({ page }) => {
  await isolateClientIp(page);
  const email = uniqueEmail("register");
  const verificationHref = await registerAndVerify(page, email, password, "Browser Learner");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding/);
  await completeOnboarding(page, true);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/app/);
  await page.waitForLoadState("load");
  await logout(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/i);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto(verificationHref);
  await expect(page).toHaveURL(/\/verify-email\?status=invalid/);
});

test("forgot and reset password revoke the old session", async ({ page }) => {
  await isolateClientIp(page);
  const email = uniqueEmail("reset");
  await registerAndVerify(page, email, password, "Reset Learner");
  await completeOnboarding(page);

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

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)app$/i);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill("browser-password-456");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/app/);
});

test("Google takeover clears the unverified password credential", async ({ page }) => {
  await isolateClientIp(page);
  await clearGoogleTestUser();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Unverified Owner");
  await page.getByLabel("Email address").fill(googleEmail);
  await page.getByLabel("Password", { exact: true }).fill("attacker-password-789");
  await page.getByLabel("Confirm password").fill("attacker-password-789");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  await page.goto("/login");
  await page.getByRole("link", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await completeOnboarding(page);
  await page.waitForLoadState("load");
  await logout(page);

  await page.goto("/login");
  await page.getByLabel("Email address").fill(googleEmail);
  await page.getByLabel("Password", { exact: true }).fill("attacker-password-789");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect." })).toBeVisible();
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

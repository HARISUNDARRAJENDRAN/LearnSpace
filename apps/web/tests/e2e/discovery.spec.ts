import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("completed learner reaches personalized Home and can use the app navigation", async ({ page }) => {
  const email = `discovery-${Date.now()}@example.test`;
  const password = "discovery-password-123";

  await page.goto("/register");
  await page.getByLabel("Your name").fill("Discovery Learner");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  await page.getByRole("link", { name: "Open verification link" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.locator("[data-onboarding-hydrated]")).toHaveAttribute(
    "data-onboarding-hydrated",
    "true",
  );

  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Student" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Coursework" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("Python");
  await page.getByRole("button", { name: "Python skill" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("React");
  await page.getByRole("button", { name: "React skill" }).click();
  await page.getByPlaceholder("Search topics, skills, or domains").fill("AI");
  await page.getByRole("button", { name: /AI \/ Machine Learning/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Clear explanations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I know the basics" }).click();
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Good to see you, Discovery." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended videos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research worth reading" })).toBeVisible();
  await expect(page.getByText("Personalized from your interests")).toBeVisible();
  await expect(page.getByRole("link", { name: "Discover" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("link", { name: "Discover" }).click();
  await expect(page).toHaveURL(/\/app\/discover$/);
  await expect(page.getByRole("heading", { name: "Recommended videos" })).toBeVisible();
});

import { defineConfig, devices } from "@playwright/test";

const runId = process.env.PLAYWRIGHT_RUN_ID ?? "local";
const productionServer = process.env.PLAYWRIGHT_E2E_SERVER === "production" || process.env.CI === "true";
process.env.APP_URL = "http://localhost:3101";
process.env.AUTH_SECRET = "playwright-auth-secret-that-is-long-enough";
process.env.AUTH_RATE_LIMIT_BACKEND = "memory";
process.env.AUTH_EXPOSE_VERIFICATION_LINK = "true";
process.env.AUTH_TEST_MODE = "true";
process.env.GOOGLE_CLIENT_ID = "playwright-client-id";
process.env.GOOGLE_CLIENT_SECRET = "playwright-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3101/api/auth/google/callback";
process.env.AUTH_TEST_GOOGLE_EMAIL = `google-e2e-${runId}@example.test`;
process.env.AUTH_TEST_GOOGLE_SUB = `playwright-google-sub-${runId}`;
process.env.PLAYWRIGHT_E2E_EMAIL = `browser-e2e-${runId}@example.test`;
process.env.AUTH_TEST_GOOGLE_AUTHORIZATION_URL = "http://127.0.0.1:4010/o/oauth2/v2/auth";
process.env.AUTH_TEST_GOOGLE_TOKEN_URL = "http://127.0.0.1:4010/token";
process.env.AUTH_TEST_GOOGLE_USERINFO_URL = "http://127.0.0.1:4010/userinfo";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://localhost:3101",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "corepack pnpm exec tsx tests/e2e/mock-google-provider.ts",
      url: "http://127.0.0.1:4010/health",
      timeout: 120_000,
      reuseExistingServer: true,
    },
    {
      command: productionServer
        ? "corepack pnpm run start:standalone"
        : "corepack pnpm exec next dev --webpack --hostname 0.0.0.0 --port 3101",
      url: "http://localhost:3101",
      env: { PORT: "3101", HOSTNAME: "0.0.0.0" },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});

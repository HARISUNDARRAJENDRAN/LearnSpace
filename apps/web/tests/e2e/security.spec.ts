import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("the local web and database ports default to loopback", () => {
  const compose = readFileSync(fileURLToPath(new URL("../../../../docker-compose.yml", import.meta.url)), "utf8");
  expect(compose).toMatch(/"127\.0\.0\.1:\$\{POSTGRES_PORT:-55432\}:5432"/);
  expect(compose).toMatch(/"127\.0\.0\.1:\$\{WEB_PORT:-3000\}:3000"/);
  expect(compose.match(/RUNNER_TOKEN: .+\$\{RUNNER_TOKEN:\?[^}]+\}/g)).toHaveLength(2);
  expect(compose).not.toContain("local-runner-token-change-me");
});

test("unauthenticated pages and APIs stay private and apply browser security headers", async ({ browser }) => {
  const baseURL = String(test.info().project.use.baseURL ?? "http://localhost:3101");
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    let calls = 0;
    const media = navigator.mediaDevices;
    if (media) Object.defineProperty(media, "getUserMedia", { configurable: true, value: async () => { calls += 1; throw new DOMException("denied", "NotAllowedError"); } });
    Object.assign(window, { __securityMediaCalls: () => calls });
  });

  const protectedPaths = [
    "/api/v1/study-sessions",
    "/api/v1/discovery/debug",
    `/api/v1/study-sessions/${"00000000-0000-4000-8000-000000000001"}/notes`,
  ];
  for (const path of protectedPaths) {
    const response = await context.request.get(path);
    expect(response.status(), path).toBe(401);
    const body = await response.text();
    expect(body).not.toMatch(/passwordHash|sessionToken|RUNNER_TOKEN/i);
  }

  await page.goto("/app/study/paper/00000000-0000-4000-8000-000000000001");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __securityMediaCalls: () => number }).__securityMediaCalls())).toBe(0);

  const response = await context.request.get("/login");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("microphone=(self)");
  // HSTS is production-only (the same switch the config uses), so dev runs over http never pin the host.
  const productionServer = process.env.PLAYWRIGHT_E2E_SERVER === "production" || process.env.CI === "true";
  if (productionServer) expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  else expect(headers["strict-transport-security"]).toBeUndefined();
  expect(violations).toEqual([]);
  await context.close();
});

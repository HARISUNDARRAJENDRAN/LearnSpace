import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { sessionCookieName } from "../../lib/auth/cookies";
import { cleanupResearchFixture, seedResearchFixture, tinyPaperPdf, type ResearchFixture } from "./research-fixture";
import { openTool, studyTool } from "./study-tools";

test.describe.configure({ mode: "serial" });

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
test.skip(!databaseUrl, "requires the local e2e database environment");

let database: ReturnType<typeof postgres> | null = null;
let fixture: ResearchFixture | null = null;

test.beforeAll(async () => {
  database = postgres(databaseUrl as string, { max: 1, prepare: false, connect_timeout: 10 });
  fixture = await seedResearchFixture(database);
});

test.afterAll(async () => {
  if (!database) return;
  try {
    if (fixture) await cleanupResearchFixture(database, fixture);
  } finally {
    await database.end({ timeout: 5 });
    database = null;
    fixture = null;
  }
});

test.beforeEach(async ({ page }) => {
  if (!fixture) throw new Error("Research fixture was not seeded");
  await page.setExtraHTTPHeaders({ "x-real-ip": `playwright-research-${randomUUID()}` });
  await page.context().addCookies([{ name: sessionCookieName, value: fixture.sessionToken, url: "http://localhost:3101", httpOnly: true, sameSite: "Lax" }]);
  await page.route("**/api/v1/papers/*/pdf", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: tinyPaperPdf() }));
});

async function searchAndOpenPaper(page: Page, query: string, title: string) {
  await page.goto("/app/research");
  const input = page.getByRole("combobox", { name: "Search LearnSpace" });
  await expect(input).toHaveAttribute("placeholder", "Search papers and sessions");
  await input.fill(query);
  const option = page.getByRole("option").filter({ hasText: title }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/app\/study\/paper\/[0-9a-f-]+/);
  await expect(page.locator(".paper-reader-scroll")).toBeVisible();
  await expect(page.locator(".paper-reader-paging input")).toHaveAttribute("max", "3");
}

async function goToSection(page: Page, section: string) {
  const outline = page.getByLabel("Jump to section");
  const pageInput = page.locator(".paper-reader-paging input");
  await expect(outline).toBeVisible();
  const selected = await outline.locator("option:checked").textContent();
  if (selected?.includes(section)) {
    await outline.selectOption({ label: section.startsWith("3.") ? "4. Split Finding Algorithms" : "3. Tree Boosting in Practice" });
  }
  await outline.selectOption({ label: section });
  await expect(pageInput).toHaveValue("2");
}

function browserVoice(page: Page) {
  return {
    say: (text: string) => page.evaluate((value) => (window as unknown as { __voice: FakeVoice }).__voice.say(value), text),
    spoken: () => page.evaluate(() => (window as unknown as { __voice: FakeVoice }).__voice.spoken()),
  };
}

type FakeVoice = { say: (text: string) => void; spoken: () => string; open: () => number };

/** Same fake on-device workers and fake microphone stream used by notes.spec.ts. */
async function fakeVoice(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    const NativeWorker = window.Worker;
    let vad: FakeWorker | null = null;
    let listener: FakeWorker | null = null;
    let epoch = 0;
    let open = 0;
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      loaded = false;
      reply(data: unknown) { setTimeout(() => this.onmessage?.({ data }), 0); }
      postMessage(message: { type?: string; listener?: string; frames?: unknown; epoch?: number; id?: number; text?: string }) {
        if (message.type === "connect" && message.frames) vad = this;
        if (message.type === "reset" && this !== vad) epoch = message.epoch ?? epoch;
        if (message.type === "load" && !this.loaded) { this.loaded = true; open += 1; }
        if (message.type === "load" && message.listener) { listener = this; this.reply({ type: "ready", listener: "moonshine", unsuitable: false }); }
        else if (message.type === "load") this.reply({ type: "ready" });
        else if (message.type === "speak") { spoken.push(message.text ?? ""); this.reply({ type: "audio", id: message.id, samples: new Float32Array(2_400), sampleRate: 24_000 }); }
      }
      addEventListener() {}
      terminate() { if (this.loaded) open -= 1; this.loaded = false; if (listener === this) listener = null; if (vad === this) vad = null; }
    }
    Object.assign(window, {
      Worker: new Proxy(NativeWorker, {
        construct(target, args) {
          // Only pdf.js keeps a real worker; production builds serve the voice workers under hashed names.
          return /pdf\.worker/i.test(String(args[0])) ? Reflect.construct(target, args) : new FakeWorker();
        },
      }),
      __voice: {
        say: (text: string) => { vad?.onmessage?.({ data: { type: "speech" } }); listener?.onmessage?.({ data: { type: "final", text, heard: true, endedAt: Date.now(), epoch } }); },
        spoken: () => spoken.join(" "),
        open: () => open,
      },
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => new AudioContext().createMediaStreamDestination().stream });
  });
}

async function tabTo(page: Page, matches: (active: { name: string | null; text: string; role: string | null }) => boolean) {
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      return {
        name: element?.getAttribute("aria-label") ?? null,
        text: element?.textContent?.trim() ?? "",
        role: element?.getAttribute("role") ?? null,
      };
    });
    if (matches(active)) return active;
  }
  throw new Error("Keyboard focus did not reach the requested control");
}

test("Workflow A — beginner path, cited paper study, notes, save and resume at the same place", async ({ page }) => {
  await page.goto("/app/research/discover");
  await expect(page.getByRole("heading", { name: "Learning paths", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /ML research foundations \(beginner\)/ }).click();
  await expect(page).toHaveURL(/\/app\/research\/discover\/ml-foundations$/);
  await expect(page.getByRole("heading", { name: "ML research foundations (beginner)" })).toBeVisible();
  // A path's concept opens Learn mode's Start learning on that concept, without starting a search.
  const concept = page.locator(".discover-item").filter({ has: page.getByRole("link", { name: "Learn it" }) }).first();
  const conceptTitle = (await concept.locator("h4").textContent())?.trim() ?? "";
  await concept.getByRole("link", { name: "Learn it" }).click();
  await expect(page).toHaveURL(/\/app\/discover\?learn=/);
  await expect(page.getByRole("textbox", { name: "What do you want to learn?" })).toHaveValue(conceptTitle);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/research\/discover\/ml-foundations$/);
  await page.locator(".discover-item").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" }).getByRole("button", { name: "Study", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/study\/paper\/[0-9a-f-]+/);
  const sessionId = page.url().split("/").at(-1)!;
  await expect(page.getByRole("heading", { name: "XGBoost: A Scalable Tree Boosting System" })).toBeVisible();

  await openTool(page, "AI");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await panel.getByLabel("Ask the tutor").fill("What does the regularized objective do?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText(/balances prediction loss against a penalty for model complexity/)).toBeVisible();
  await expect(panel.getByRole("button", { name: /Go to p\. 1 of the paper/ })).toBeVisible();

  await goToSection(page, "3. Tree Boosting in Practice");
  await openTool(page, "Notes");
  await expect(panel.locator(".notes-page")).toContainText("A. Research context");
  await expect(panel.locator(".notes-page")).toContainText("XGBoost balances prediction loss");
  await expect(studyTool(page, "Notes")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(4_300);

  await page.getByRole("link", { name: "Back to Research" }).click();
  await expect(page.locator(".research-page")).toBeVisible();
  await page.goto("/app/research?q=XGBoost");
  const paperRow = page.locator("article.research-paper-row").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" }).first();
  await expect(paperRow).toBeVisible();
  await paperRow.getByRole("button", { name: "Save to library" }).click();
  await expect(paperRow.getByRole("button", { name: "Remove from library" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Recently saved").getByRole("link", { name: "See the full list" }).click();
  await expect(page).toHaveURL(/\/app\/library\?view=papers/);
  const resume = page.locator(".watch-later-card").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" }).getByRole("link", { name: "Continue in Sessions" });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page).toHaveURL(new RegExp(`/app/study/paper/${sessionId}(?:\\?.*)?$`));
  await expect(page.locator(".paper-reader-paging input")).toHaveValue("2");
});

test("Workflow B — search ranks papers, opens a section and resolved citation, then saves an insight", async ({ page }) => {
  await page.goto("/app/research");
  const input = page.getByRole("combobox", { name: "Search LearnSpace" });
  await input.fill("boosting");
  const xgboost = page.getByRole("option").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" }).first();
  const gpu = page.getByRole("option").filter({ hasText: "GPU-dependent distributed boosting" }).first();
  await expect(xgboost).toBeVisible();
  await expect(gpu).toBeVisible();
  const options = await page.getByRole("option").allTextContents();
  expect(options.findIndex((item) => item.includes("XGBoost: A Scalable Tree Boosting System"))).toBeLessThan(options.findIndex((item) => item.includes("GPU-dependent distributed boosting")));
  await xgboost.click();
  await expect(page).toHaveURL(/\/app\/study\/paper\//);
  const sourceSessionId = page.url().split("/").at(-1)!;
  await goToSection(page, "4. Split Finding Algorithms");
  await openTool(page, "AI");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await panel.getByLabel("Ask the tutor").fill("What related research does the paper cite?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText(/verified bibliography identifies a related paper/)).toBeVisible();

  await page.getByRole("button", { name: "Focus mode" }).click();
  const focus = page.getByRole("dialog", { name: "Focus mode: XGBoost: A Scalable Tree Boosting System" });
  await expect(focus).toBeVisible();
  await expect(focus.getByRole("heading", { name: "4. Split Finding Algorithms" })).toBeVisible();
  await focus.getByRole("button", { name: "Reference 1" }).first().click();
  const reference = page.getByRole("dialog", { name: "Reference 1" });
  await expect(reference.getByText("A Verified Tree Boosting Reference")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reference).toHaveCount(0);
  await focus.getByRole("button", { name: "Leave focus mode" }).click();
  await openTool(page, "Notes");
  const notes = page.locator(".notes-page");
  await expect(notes).toContainText("A. Research context");
  await notes.locator(".notes-block-text").last().click();
  await page.keyboard.press("End");
  const insightSaved = page.waitForResponse((response) => response.url().endsWith(`/study-sessions/${sourceSessionId}/notes`) && response.request().method() === "PATCH" && response.ok());
  await page.keyboard.press("Enter");
  await page.keyboard.type("Key insight: the objective trades prediction fit against model complexity.");
  await expect(notes).toContainText("Key insight: the objective trades prediction fit against model complexity.");
  await insightSaved;
  await page.reload();
  await expect(page.locator(".notes-page")).toContainText("Key insight: the objective trades prediction fit against model complexity.");
});

test("Workflow B citation navigation — a verified reference opens its paper", async ({ page }) => {
  await searchAndOpenPaper(page, "XGBoost", "XGBoost: A Scalable Tree Boosting System");
  await page.getByRole("button", { name: "Focus mode" }).click();
  const focus = page.getByRole("dialog", { name: "Focus mode: XGBoost: A Scalable Tree Boosting System" });
  await expect(focus.getByRole("heading", { name: "4. Split Finding Algorithms" })).toBeVisible();
  await focus.getByRole("button", { name: "Reference 1" }).first().click();
  const reference = page.getByRole("dialog", { name: "Reference 1" });
  await expect(reference.getByText("A Verified Tree Boosting Reference")).toBeVisible();
  const studyIt = reference.getByRole("button", { name: "Study it" });
  await studyIt.click();
  await expect(page.getByRole("heading", { name: "A Verified Tree Boosting Reference" })).toBeVisible();
});

test("Workflow C — voice explains a selected equation, handles an interruption, and saves the example", async ({ page }) => {
  await fakeVoice(page);
  const voiceTurns: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/study-sessions\/[^/]+\/voice$/.test(request.url())) voiceTurns.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.route("**/api/v1/study-sessions/*/voice", async (route) => {
    const utterance = (route.request().postDataJSON() as { utterance?: string | null }).utterance;
    if (utterance?.startsWith("Explain the selected equation")) await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue().catch(() => undefined);
  });
  await searchAndOpenPaper(page, "XGBoost", "XGBoost: A Scalable Tree Boosting System");
  await goToSection(page, "3. Tree Boosting in Practice");
  await openTool(page, "Notes");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  const you = browserVoice(page);
  await expect(panel.getByRole("button", { name: "End the talk with Luny" })).toBeVisible();
  await expect.poll(() => you.spoken()).toContain("What part of the paper are you working through?");

  const equation = page.locator('.paper-page[data-page="2"] .textLayer');
  await expect(equation).toContainText("Objective = loss + complexity penalty");
  await equation.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await you.say("Explain the selected equation");
  await expect(panel.getByText("Thinking…")).toBeAttached();
  await you.say("Wait, give me a worked example");
  await expect.poll(() => voiceTurns.at(-1)?.utterance).toContain("Wait, give me a worked example");
  await expect.poll(() => voiceTurns.at(-1)?.selection).toContain("Objective = loss + complexity penalty");
  await expect.poll(() => you.spoken()).toContain("The objective is two point five.");
  await expect(panel.locator(".notes-page")).toContainText("Worked example: with prediction loss 2 and a complexity penalty of 0.5, the objective is 2.5.");
  await page.reload();
  await expect(studyTool(page, "Notes")).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator(".notes-page")).toContainText("Worked example: with prediction loss 2 and a complexity penalty of 0.5, the objective is 2.5.");
  await panel.getByRole("button", { name: "End the talk with Luny" }).click();
  await expect(panel.getByText("Luny is off")).toBeAttached();
});

test("Workflow D — CPU paper offers an exercise, accepts a solution and runs it in the sandbox", async ({ page }) => {
  const runnerUrl = process.env.RUNNER_URL;
  const runnerToken = process.env.RUNNER_TOKEN;
  let runnerReason = "RUNNER_URL or RUNNER_TOKEN is not configured for the e2e web process";
  let runnerAvailable = false;
  if (runnerUrl && runnerToken) {
    try {
      const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/health`, { headers: { Authorization: `Bearer ${runnerToken}` }, signal: AbortSignal.timeout(2_000) });
      runnerAvailable = response.ok;
      if (!response.ok) runnerReason = `runner health returned HTTP ${response.status}`;
    } catch (error) {
      runnerReason = error instanceof Error ? error.message : "runner health probe failed";
    }
  }
  // Coding is offered only where a sandbox runner is configured, so without one the whole workflow has nothing to test.
  test.skip(!runnerAvailable, `Workflow D needs a sandbox runner: ${runnerReason}`);
  await searchAndOpenPaper(page, "XGBoost", "XGBoost: A Scalable Tree Boosting System");
  const codeTool = studyTool(page, "Code");
  await expect(codeTool).toBeVisible({ timeout: 90_000 });
  await openTool(page, "Code");
  const workspace = page.getByRole("dialog", { name: "Coding practice" });
  await expect(workspace.getByRole("heading", { name: "Practise what this lesson teaches" })).toBeVisible({ timeout: 90_000 });
  await expect(workspace.getByRole("button", { name: "Start practice" })).toBeVisible();
  await workspace.getByRole("button", { name: "Start practice" }).click();
  const problem = workspace.getByRole("region", { name: "Problem" });
  await expect(problem).toContainText("Compute the regularized objective", { timeout: 90_000 });
  await expect(problem).toContainText("weighted complexity penalty");

  const solution = "class Solution:\n    def regularizedObjective(self, loss, complexity, regularization):\n        return loss + regularization * complexity";
  const editor = workspace.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(solution);

  await workspace.getByRole("button", { name: "Run", exact: true }).click();
  await expect(workspace.getByRole("heading", { name: "Accepted" })).toBeVisible({ timeout: 90_000 });
  await expect(workspace.getByText("Output", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Expected", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Case 1" })).toHaveClass(/is-good/);
  await expect(workspace.getByRole("button", { name: "Case 2" })).toHaveClass(/is-good/);
  await workspace.getByRole("button", { name: "Back to lesson" }).click();
  await expect(page.locator(".paper-reader-scroll")).toBeVisible();
});

test("Workflow E — GPU paper has no coding tool and its guide explains the mechanism and projects", async ({ page }) => {
  await searchAndOpenPaper(page, "GPU-dependent distributed boosting", "GPU-dependent distributed boosting");
  await expect(studyTool(page, "Code")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator(".coding-workspace")).toHaveCount(0);
  await openTool(page, "Guide");
  const panel = page.getByRole("complementary", { name: "Side panel" });
  await expect(panel.getByRole("heading", { name: "A project around distributed training" })).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByRole("heading", { name: "Your project" })).toBeVisible();
  await expect(panel.getByText("Build a tiny synthetic example with two model updates.")).toBeVisible();
  await expect(panel.getByText("For future GPU access")).toBeVisible();
  await page.getByRole("button", { name: "Focus mode" }).click();
  const focus = page.getByRole("dialog", { name: "Focus mode: GPU-dependent distributed boosting" });
  await expect(focus.getByRole("heading", { name: "1. Core Mechanism" })).toBeVisible();
});

test("Research keyboard access — search, open a paper and switch study tools without a pointer", async ({ page }) => {
  await page.goto("/app/research");
  await tabTo(page, (active) => active.name === "Search LearnSpace" && active.role === "combobox");
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false)).toBe(true);
  await page.keyboard.type("XGBoost");
  await expect(page.getByRole("option").filter({ hasText: "XGBoost: A Scalable Tree Boosting System" }).first()).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    const activeText = await page.evaluate(() => {
      const input = document.activeElement as HTMLInputElement | null;
      const activeId = input?.getAttribute("aria-activedescendant");
      return activeId ? document.getElementById(activeId)?.textContent ?? "" : "";
    });
    if (activeText.includes("XGBoost: A Scalable Tree Boosting System")) break;
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/study\/paper\//);
  const tools = page.getByRole("group", { name: "Study tools" });
  for (const name of ["Notes", "Check", "Guide", "AI"]) await expect(tools.getByRole("button", { name, exact: true })).toHaveAccessibleName(name);
  const focusedAI = await tabTo(page, (active) => active.text === "AI");
  expect(focusedAI.text).toBe("AI");
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(studyTool(page, "AI")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  const active = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (active !== "Notes") await tabTo(page, (item) => item.text === "Notes");
  await page.keyboard.press("Enter");
  await expect(studyTool(page, "Notes")).toHaveAttribute("aria-pressed", "true");
});

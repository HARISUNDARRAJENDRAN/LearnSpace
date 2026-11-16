import { expect, type Page } from "@playwright/test";

/** A study tool in the lesson's tool bar (Notes, Check, AI, Code). */
export function studyTool(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

/**
 * Opens a study tool. A session reopens with the panel the learner left open, and pressing an open tool closes it, so the
 * tool is only pressed when it is not open already.
 */
export async function openTool(page: Page, name: string) {
  const tool = studyTool(page, name);
  await expect(tool).toBeVisible();
  if ((await tool.getAttribute("aria-pressed")) !== "true") await tool.click();
  await expect(tool).toHaveAttribute("aria-pressed", "true");
}

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseURL = process.env.MARKETING_URL || "http://127.0.0.1:3000";
const output = process.env.MARKETING_OUTPUT || "/tmp/learnspace-marketing";
const viewports = [
	[390, 844],
	[768, 1024],
	[1024, 768],
	[1440, 900],
	[1920, 1080],
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
	for (const [width, height] of viewports) {
		const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});

		const response = await page.goto(baseURL, { waitUntil: "networkidle" });
		assert.equal(response?.status(), 200);
		await page.evaluate(() => document.fonts.ready);

		const report = await page.evaluate(() => ({
			overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			missingAnchors: [...document.querySelectorAll('a[href^="#"]')]
				.map((link) => link.getAttribute("href"))
				.filter((href) => href !== "#" && !document.querySelector(href)),
			heroHeight: document.querySelector("[data-testid=marketing-hero]")?.getBoundingClientRect().height ?? 0,
		}));

		assert.equal(report.overflow, 0, `horizontal overflow at ${width}px`);
		assert.deepEqual(report.missingAnchors, [], `broken in-page links at ${width}px`);
		assert.ok(report.heroHeight > 0, `hero missing at ${width}px`);
		assert.deepEqual(errors, [], `browser errors at ${width}px`);

		await page.screenshot({ path: `${output}/page-${width}x${height}.png`, fullPage: true });
		await page.close();
		console.log(`ok ${width}x${height}`);
	}
} finally {
	await browser.close();
}

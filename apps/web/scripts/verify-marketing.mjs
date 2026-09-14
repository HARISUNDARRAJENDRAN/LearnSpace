import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseURL = process.env.MARKETING_URL || "http://127.0.0.1:3000";
const output = process.env.MARKETING_OUTPUT || "/tmp/learnspace-marketing";
const viewports = [
	[390, 844],
	[768, 1024],
	[1024, 768],
	[1440, 1000],
	[1536, 1000],
	[1920, 1080],
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const report = [];

try {
	for (const [width, height] of viewports) {
		const page = await browser.newPage({
			viewport: { width, height },
			deviceScaleFactor: 1,
		});
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});

		const response = await page.goto(baseURL, { waitUntil: "networkidle" });
		assert.equal(response?.status(), 200);
		await page.evaluate(() => document.fonts.ready);

		// Decode lazy artwork before taking the regression screenshot.
		for (const image of await page.locator("img").all()) {
			await image.evaluate((element) => {
				element.closest(".scenic-panel")?.scrollIntoView({
					block: "center",
					behavior: "instant",
				});
			});
			await image.evaluate((element) => element.decode());
		}
		await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
		await page.screenshot({
			path: `${output}/page-${width}x${height}.png`,
			fullPage: true,
		});

		const featureCards = await page.locator(".feature-card").evaluateAll((cards) =>
			cards.map((card) => {
				const bounds = card.getBoundingClientRect();
				const children = [...card.children].map((child) => child.getBoundingClientRect());
				return {
					title: card.querySelector("h3").textContent,
					contained: children.every((box) => box.left >= bounds.left && box.right <= bounds.right + 1 && box.top >= bounds.top && box.bottom <= bounds.bottom + 1),
					overlap: children.some((box, index) => children.slice(index + 1).some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)),
				};
			}),
		);
		assert.equal(featureCards.length, 6);
		for (const card of featureCards) {
			assert.ok(card.contained, `${card.title}: content outside card at ${width}px`);
			assert.ok(!card.overlap, `${card.title}: overlapping text/artwork at ${width}px`);
		}
		await page.locator(".feature-grid").screenshot({ path: `${output}/features-${width}.png` });

		const geometry = await page.evaluate(() => {
			const hero = document.querySelector("[data-testid=marketing-hero]");
			const content = document.querySelector(".content-container");
			const main = document.querySelector("main");
			if (!hero || !content || !main) throw new Error("Marketing shell missing");
			const heroBox = hero.getBoundingClientRect();
			const contentBox = content.getBoundingClientRect();
			const mainBox = main.getBoundingClientRect();
			const bodyBox = document.body.getBoundingClientRect();
			const documentBox = document.documentElement.getBoundingClientRect();
			const ancestorStyles = [];
			let current = hero;
			while (current) {
				const styles = getComputedStyle(current);
				ancestorStyles.push({
					tag: current.tagName.toLowerCase(),
					id: current.id,
					className: String(current.className),
					width: styles.width,
					maxWidth: styles.maxWidth,
					minWidth: styles.minWidth,
					marginLeft: styles.marginLeft,
					marginRight: styles.marginRight,
					paddingLeft: styles.paddingLeft,
					paddingRight: styles.paddingRight,
					transform: styles.transform,
					position: styles.position,
					left: styles.left,
					right: styles.right,
					inset: styles.inset,
					display: styles.display,
					justifyContent: styles.justifyContent,
					alignItems: styles.alignItems,
					overflow: styles.overflow,
					zoom: styles.zoom,
				});
				current = current.parentElement;
			}
			return {
				innerWidth,
				documentWidth: documentBox.width,
				documentClientWidth: document.documentElement.clientWidth,
				documentScrollWidth: document.documentElement.scrollWidth,
				bodyWidth: bodyBox.width,
				mainWidth: mainBox.width,
				heroWidth: heroBox.width,
				heroX: heroBox.x,
				heroRight: heroBox.right,
				leftGutter: heroBox.x,
				rightGutter: innerWidth - heroBox.right,
				contentWidth: contentBox.width,
				contentX: contentBox.x,
				ancestorStyles,
				brokenImages: [...document.images]
					.filter((image) => !image.complete || !image.naturalWidth)
					.map((image) => image.currentSrc || image.src),
				sections: [...main.children].map((element) => {
					const { x, y, width: sectionWidth, height: sectionHeight } =
						element.getBoundingClientRect();
					return {
						name: String(element.className),
						x,
						y,
						width: sectionWidth,
						height: sectionHeight,
					};
				}),
			};
		});

		assert.equal(
			geometry.documentScrollWidth <= width + 1,
			true,
			`Horizontal overflow at ${width}px`,
		);
		assert.ok(Math.abs(geometry.documentWidth - width) <= 1, `Document width at ${width}px`);
		assert.ok(
			Math.abs(geometry.documentClientWidth - width) <= 1,
			`Document client width at ${width}px`,
		);
		assert.ok(Math.abs(geometry.bodyWidth - width) <= 1, `Body width at ${width}px`);
		assert.ok(Math.abs(geometry.mainWidth - width) <= 1, `Main width at ${width}px`);
		assert.ok(
			Math.abs(geometry.leftGutter - geometry.rightGutter) <= 2,
			`Hero centering at ${width}px`,
		);
		assert.deepEqual(geometry.brokenImages, []);
		assert.deepEqual(errors, [], `Browser errors at ${width}px`);

		if (width === 1440) {
			assert.ok(geometry.heroWidth >= 1320 && geometry.heroWidth <= 1396);
		}
		if (width === 1536) assert.ok(geometry.heroWidth >= 1410);
		if (width === 1024) assert.ok(geometry.heroWidth >= 960);
		if (width === 390) assert.ok(geometry.heroWidth >= 358 && geometry.heroWidth <= 374);

		const anchorHrefs = new Set(
			await page
				.locator('a[href^="#"]')
				.evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
		);
		for (const href of anchorHrefs) {
			assert.equal(
				(await page.locator(href).count()) > 0,
				true,
				`Missing anchor ${href}`,
			);
		}

		report.push({ viewport: { width, height }, ...geometry, errors });
		await page.close();
	}
} finally {
	await browser.close();
}

await writeFile(`${output}/geometry.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

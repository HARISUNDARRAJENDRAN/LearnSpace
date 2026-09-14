import { chromium } from "@playwright/test";

const baseURL = process.env.MARKETING_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch();
try {
	for (const deviceScaleFactor of [1, 2]) {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
			deviceScaleFactor,
		});
		await page.goto(baseURL, { waitUntil: "networkidle" });
		await page.evaluate(() => document.fonts.ready);
		for (const image of await page.locator("img").all()) {
			await image.evaluate((element) => element.scrollIntoView({ behavior: "instant" }));
			await image.evaluate((element) => element.decode());
		}
		const rows = await page.evaluate((dpr) =>
			[...document.images].map((image) => {
				const rect = image.getBoundingClientRect();
				const renderedWidth = Math.round(rect.width * 100) / 100;
				const renderedHeight = Math.round(rect.height * 100) / 100;
				const requiredWidth = Math.ceil(renderedWidth * dpr);
				const selectedCandidate = Number(
					new URL(image.currentSrc || image.src, window.location.href).searchParams.get("w"),
				);
				// Chromium exposes a density-corrected naturalWidth for some srcset
				// candidates. The w descriptor is the physical candidate width and is
				// therefore the reliable source-resolution check.
				const physicalSourceWidth = selectedCandidate || image.naturalWidth;
				return {
					src: image.currentSrc || image.src,
					naturalWidth: image.naturalWidth,
					naturalHeight: image.naturalHeight,
					renderedWidth,
					renderedHeight,
					deviceScaleFactor: dpr,
					requiredWidth,
					physicalSourceWidth,
					naturalWidthResolutionOk: image.naturalWidth >= requiredWidth,
					resolutionOk: physicalSourceWidth >= requiredWidth,
					className: image.className,
				};
			}),
			deviceScaleFactor,
		);
		console.log(JSON.stringify({ deviceScaleFactor, rows }, null, 2));
		await page.close();
	}
} finally {
	await browser.close();
}

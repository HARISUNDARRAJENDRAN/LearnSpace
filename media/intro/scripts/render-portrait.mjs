import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const work = await mkdtemp(join(tmpdir(), "learnspace-mobile-intro-"));
const media = fileURLToPath(new URL("../../../apps/web/public/media/", import.meta.url));
const cue = fileURLToPath(new URL("../assets/sfx/chip-1.wav", import.meta.url));
const output = join(media, "learnspace-intro-portrait.mp4");

function ffmpeg(args) {
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`FFmpeg exited with status ${run.status}`);
}

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 960 } });
  await page.goto(new URL("../portrait.html", import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);

  const shots = page.locator("main section");
  const frames = [];
  const cues = [];
  let duration = 0;

  async function frame(hold) {
    const path = join(work, `frame-${frames.length}.png`);
    await page.screenshot({ path });
    frames.push({ path, hold });
    duration += hold;
    return path;
  }

  for (let index = 0; index < await shots.count(); index++) {
    const shot = shots.nth(index);
    await shot.evaluate((node) => {
      document.querySelector(".active")?.classList.remove("active");
      node.classList.add("active");
    });
    const bottom = await shot.evaluate((node) => node.getBoundingClientRect().bottom);
    if (bottom > 912) throw new Error(`Scene ${index + 1} exceeds the safe area: ${bottom}`);

    if (index > 0) {
      for (let step = 1; step < 8; step++) {
        await shot.evaluate((node, progress) => {
          node.style.opacity = progress;
          node.style.transform = `translateY(${(1 - progress) * 16}px)`;
        }, step / 8);
        await frame(0.04);
      }
      await shot.evaluate((node) => node.removeAttribute("style"));
    }

    const highlighted = await shot.locator("[data-highlight]").count() > 0;
    const still = await frame(highlighted ? 1.56 : 3.2);
    if (index === 0) {
      ffmpeg(["-i", still, "-frames:v", "1", "-c:v", "libwebp", "-quality", "85",
        join(media, "learnspace-intro-portrait-poster.webp")]);
    }
    if (highlighted) {
      cues.push(Math.round(duration * 1000));
      await shot.evaluate((node) => node.classList.add("demonstrated"));
      await frame(2.48);
    }
  }

  const list = join(work, "frames.txt");
  await writeFile(list, frames.map(({ path, hold }) => `file '${path}'\nduration ${hold}\n`).join("") +
    `file '${frames.at(-1).path}'\n`);
  const mix = cues.map((delay, index) => `[1:a]adelay=${delay}:all=1[cue${index}]`).join(";") + ";" +
    cues.map((_, index) => `[cue${index}]`).join("") +
    `amix=inputs=${cues.length}:normalize=0,volume=0.55,apad[audio]`;

  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-i", cue, "-filter_complex", mix,
    "-map", "0:v", "-map", "[audio]", "-vf", "fps=25", "-t", duration.toFixed(2),
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", output]);
} finally {
  await browser?.close();
  await rm(work, { recursive: true, force: true });
}

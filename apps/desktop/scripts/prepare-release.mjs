import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawUrl = process.env.LEARNSPACE_DESKTOP_APP_URL;

if (!rawUrl) {
  throw new Error("LEARNSPACE_DESKTOP_APP_URL is required to package LearnSpace.");
}

const appUrl = new URL(rawUrl);
if (
  appUrl.protocol !== "https:" ||
  appUrl.username ||
  appUrl.password ||
  appUrl.pathname !== "/" ||
  appUrl.search ||
  appUrl.hash ||
  ["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname)
) {
  throw new Error("LEARNSPACE_DESKTOP_APP_URL must be an HTTPS origin without credentials or a path.");
}

await writeFile(
  path.join(packageRoot, "dist-release-config.json"),
  `${JSON.stringify({ appUrl: appUrl.origin })}\n`,
  "utf8",
);

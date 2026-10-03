import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const standaloneApp = path.join(appRoot, distDir, "standalone", "apps", "web");

await cp(path.join(appRoot, "public"), path.join(standaloneApp, "public"), {
  recursive: true,
  force: true,
});
await cp(path.join(appRoot, distDir, "static"), path.join(standaloneApp, distDir, "static"), {
  recursive: true,
  force: true,
});

process.env.HOSTNAME = "0.0.0.0";
process.env.PORT ??= "3100";

await import(pathToFileURL(path.join(standaloneApp, "server.js")).href);

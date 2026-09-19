import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneApp = path.join(appRoot, ".next", "standalone", "apps", "web");

await cp(path.join(appRoot, "public"), path.join(standaloneApp, "public"), {
  recursive: true,
  force: true,
});
await cp(path.join(appRoot, ".next", "static"), path.join(standaloneApp, ".next", "static"), {
  recursive: true,
  force: true,
});

process.env.HOSTNAME = "localhost";
process.env.PORT ??= "3100";

await import(pathToFileURL(path.join(standaloneApp, "server.js")).href);

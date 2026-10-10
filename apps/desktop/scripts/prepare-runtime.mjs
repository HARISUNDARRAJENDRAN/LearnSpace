import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.resolve(packageRoot, "../web");
const distDir = process.env.NEXT_DIST_DIR ?? ".next";

const standalone = path.join(webRoot, distDir, "standalone");
const serverJs = path.join(standalone, "apps", "web", "server.js");
const runtimeRoot = path.join(packageRoot, "dist-runtime", "runtime");
const runtimeApp = path.join(runtimeRoot, "apps", "web");

try {
  await import("node:fs").then((fs) => fs.accessSync(serverJs));
} catch {
  console.error(
    `Standalone build not found at ${serverJs}.\nRun \`pnpm --filter @learnspace/web build\` first.`,
  );
  process.exit(1);
}

await cp(standalone, runtimeRoot, { recursive: true, force: true });
await mkdir(path.join(runtimeApp, distDir, "static"), { recursive: true });
await cp(path.join(webRoot, distDir, "static"), path.join(runtimeApp, distDir, "static"), {
  recursive: true,
  force: true,
});
await cp(path.join(webRoot, "public"), path.join(runtimeApp, "public"), {
  recursive: true,
  force: true,
});

console.log(`Packaged runtime staged at ${runtimeRoot}`);

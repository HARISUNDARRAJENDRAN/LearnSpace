import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await cp(path.join(packageRoot, "src", "preload.cjs"), path.join(packageRoot, "dist", "preload.cjs"));

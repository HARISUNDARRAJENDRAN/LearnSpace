import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("PDF.js stays at or above the release that fixes malicious PDF scripting", () => {
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL("../node_modules/pdfjs-dist/package.json", import.meta.url)), "utf8")) as { version: string };
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  assert.ok(major > 6 || (major === 6 && (minor > 2 || (minor === 2 && patch >= 108))), `pdfjs-dist ${version} is below 6.2.108`);
});

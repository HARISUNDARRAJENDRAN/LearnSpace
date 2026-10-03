import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const tailwindRequire = createRequire(require.resolve("tailwindcss/package.json"));
const micromatchRequire = createRequire(tailwindRequire.resolve("micromatch"));
const braces = micromatchRequire("braces") as {
  (pattern: string): string[];
  parse(pattern: string): unknown;
  compile(pattern: string): string;
  expand(pattern: string): string[];
};

test("patched braces rejects pathological nesting through every parser entry point", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"]] as const) {
    const pattern = `${open.repeat(4000)}a${close.repeat(4000)}`;
    for (const parse of [braces, braces.parse, braces.compile, braces.expand]) {
      assert.throws(() => parse(pattern), /Pattern nesting exceeds 128 levels/);
    }
  }
  assert.deepEqual(braces.expand("src/{app,components}/*.{ts,tsx}"), [
    "src/app/*.ts", "src/app/*.tsx", "src/components/*.ts", "src/components/*.tsx",
  ]);
});

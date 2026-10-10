import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyLaunchMode } from "../src/launch-mode.js";

describe("classifyLaunchMode", () => {
  it("prefers attach mode for a loopback URL", () => {
    assert.deepEqual(
      classifyLaunchMode({
        attachUrl: "http://127.0.0.1:3000",
        isPackaged: false,
        runtimeDirOverride: undefined,
      }),
      { mode: "attach", url: "http://127.0.0.1:3000" },
    );
  });

  it("rejects non-loopback attach URLs", () => {
    assert.throws(
      () =>
        classifyLaunchMode({
          attachUrl: "https://evil.example",
          isPackaged: false,
          runtimeDirOverride: undefined,
        }),
      /loopback/,
    );
  });

  it("uses the packaged runtime when running from an installed app", () => {
    assert.deepEqual(
      classifyLaunchMode({
        attachUrl: undefined,
        isPackaged: true,
        runtimeDirOverride: undefined,
      }),
      { mode: "packaged" },
    );
  });

  it("uses the packaged runtime when a runtime dir override is set in development", () => {
    assert.deepEqual(
      classifyLaunchMode({
        attachUrl: undefined,
        isPackaged: false,
        runtimeDirOverride: "/tmp/staged-runtime",
      }),
      { mode: "packaged" },
    );
  });

  it("defaults to the development server in the repository", () => {
    assert.deepEqual(
      classifyLaunchMode({
        attachUrl: undefined,
        isPackaged: false,
        runtimeDirOverride: undefined,
      }),
      { mode: "dev" },
    );
  });

  it("an empty attach URL is ignored", () => {
    assert.deepEqual(
      classifyLaunchMode({
        attachUrl: "",
        isPackaged: false,
        runtimeDirOverride: undefined,
      }),
      { mode: "dev" },
    );
  });
});

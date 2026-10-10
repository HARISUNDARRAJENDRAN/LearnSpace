import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { buildRuntimeEnv, loadConfigOverrides, loadOrCreateAuthSecret } from "../src/config.js";

describe("buildRuntimeEnv", () => {
  it("binds the runtime to loopback with an explicit desktop flag", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const env = await buildRuntimeEnv({
      port: 4321,
      userDataDir: userData,
      baseEnv: { PATH: "/usr/bin", HOME: "/home/user" },
    });

    assert.equal(env.APP_URL, "http://127.0.0.1:4321");
    assert.equal(env.HOSTNAME, "127.0.0.1");
    assert.equal(env.PORT, "4321");
    assert.equal(env.LEARNSPACE_DESKTOP_RUNTIME, "true");
    assert.equal(env.NODE_ENV, "production");
    assert.ok((env.AUTH_SECRET ?? "").length >= 32, "AUTH_SECRET must be >= 32 chars");
  });

  it("applies user config overrides over built-in local defaults", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(userData, "config.json"),
      JSON.stringify({ DATABASE_URL: "postgres://example:5432/other" }),
    );
    const env = await buildRuntimeEnv({ port: 1, userDataDir: userData, baseEnv: {} });
    assert.equal(env.DATABASE_URL, "postgres://example:5432/other");
  });

  it("provides loopback service defaults when no user config exists", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const env = await buildRuntimeEnv({ port: 1, userDataDir: userData, baseEnv: {} });
    assert.match(env.DATABASE_URL ?? "", /^postgres:\/\/[^@]*@127\.0\.0\.1:55432\//);
    assert.match(env.REDIS_URL ?? "", /^redis:\/\/127\.0\.0\.1:56379\//);
    assert.match(env.DISCOVERY_AGENT_URL ?? "", /^http:\/\/127\.0\.0\.1:8080$/);
  });

  it("never forwards NODE_OPTIONS from the parent environment", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const env = await buildRuntimeEnv({
      port: 1,
      userDataDir: userData,
      baseEnv: { NODE_OPTIONS: "--inspect=0.0.0.0:9229", PATH: "/usr/bin" },
    });
    assert.equal(env.NODE_OPTIONS, undefined);
  });

  it("never forwards APP_URL or LEARNSPACE_DESKTOP_RUNTIME supplied by the parent", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const env = await buildRuntimeEnv({
      port: 4321,
      userDataDir: userData,
      baseEnv: { APP_URL: "https://evil.example", LEARNSPACE_DESKTOP_RUNTIME: "false" },
    });
    assert.equal(env.APP_URL, "http://127.0.0.1:4321");
    assert.equal(env.LEARNSPACE_DESKTOP_RUNTIME, "true");
  });
});

describe("loadOrCreateAuthSecret", () => {
  it("creates a strong secret once and reuses it", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const first = await loadOrCreateAuthSecret(userData);
    assert.ok(first.length >= 32);
    const second = await loadOrCreateAuthSecret(userData);
    assert.equal(first, second);
    const mode = (await stat(path.join(userData, "auth-secret"))).mode & 0o777;
    assert.equal(mode, 0o600, "auth secret file must not be world/group readable");
  });
});

describe("loadConfigOverrides", () => {
  it("returns empty object when config file is absent or invalid", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    assert.deepEqual(await loadConfigOverrides(userData), {});
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(userData, "config.json"), "{not json");
    assert.deepEqual(await loadConfigOverrides(userData), {});
  });

  it("ignores keys that are not uppercase env names", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "ls-cfg-"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(userData, "config.json"),
      JSON.stringify({ DATABASE_URL: "postgres://x", "rm -rf": "no", lower: "no" }),
    );
    const overrides = await loadConfigOverrides(userData);
    assert.deepEqual(Object.keys(overrides), ["DATABASE_URL"]);
  });
});

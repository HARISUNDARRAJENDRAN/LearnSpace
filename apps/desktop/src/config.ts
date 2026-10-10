import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const AUTH_SECRET_FILE = "auth-secret";
const CONFIG_FILE = "config.json";
const MINIMUM_AUTH_SECRET_LENGTH = 32;

// Loopback defaults matching the repository's local Compose stack. These are
// the same development endpoints committed in docker-compose.yml — no
// production credentials are embedded in the desktop package.
const LOCAL_SERVICE_DEFAULTS = {
  DATABASE_URL: "postgres://learnspace_app:learnspace_app@127.0.0.1:55432/learnspace",
  DATABASE_AUTH_URL: "postgres://learnspace_auth:learnspace_auth@127.0.0.1:55432/learnspace",
  DATABASE_WORKER_URL: "postgres://learnspace_worker:learnspace_worker@127.0.0.1:55432/learnspace",
  REDIS_URL: "redis://127.0.0.1:56379/0",
  DISCOVERY_AGENT_URL: "http://127.0.0.1:8080",
} as const;

// Parent-process variables that must never reach the bundled runtime:
// NODE_OPTIONS / inspector flags would allow code injection into the trusted
// server process, and the app-identity variables are owned by this module.
const BLOCKED_PARENT_KEYS = [
  "NODE_OPTIONS",
  "APP_URL",
  "LEARNSPACE_DESKTOP_RUNTIME",
  "LEARNSPACE_DESKTOP_SERVER_URL",
  "ELECTRON_RUN_AS_NODE",
] as const;

const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export interface RuntimeEnvInput {
  port: number;
  userDataDir: string;
  baseEnv?: Record<string, string | undefined>;
  /** Explicit caller-provided values with highest precedence (used by tests/dev). */
  overrides?: Record<string, string | undefined>;
}

export async function loadOrCreateAuthSecret(userDataDir: string): Promise<string> {
  const secretPath = path.join(userDataDir, AUTH_SECRET_FILE);
  try {
    const existing = (await readFile(secretPath, "utf8")).trim();
    if (existing.length >= MINIMUM_AUTH_SECRET_LENGTH) {
      return existing;
    }
  } catch {
    // Missing or unreadable — generate below.
  }

  const secret = randomBytes(48).toString("base64url");
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });
  await chmod(secretPath, 0o600);
  return secret;
}

export async function loadConfigOverrides(userDataDir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path.join(userDataDir, CONFIG_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const overrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (ENV_NAME_PATTERN.test(key) && typeof value === "string") {
        overrides[key] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

/**
 * Builds the environment for the bundled Next.js standalone runtime.
 * Everything is loopback-scoped, explicitly flagged as the desktop runtime,
 * and derived only from user-config + local defaults — never from packaged
 * secrets or untrusted parent-process variables.
 */
export async function buildRuntimeEnv(input: RuntimeEnvInput): Promise<Record<string, string>> {
  const base = input.baseEnv ?? process.env;
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !(BLOCKED_PARENT_KEYS as readonly string[]).includes(key)) {
      env[key] = value;
    }
  }

  const userOverrides = await loadConfigOverrides(input.userDataDir);
  const resolvedOverrides: Record<string, string | undefined> = {
    ...LOCAL_SERVICE_DEFAULTS,
    ...userOverrides,
    ...(input.overrides ?? {}),
  };

  for (const [key, value] of Object.entries(resolvedOverrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.NODE_ENV = "production";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.HOSTNAME = "127.0.0.1";
  env.PORT = String(input.port);
  env.APP_URL = `http://127.0.0.1:${input.port}`;
  env.LEARNSPACE_DESKTOP_RUNTIME = "true";
  env.AUTH_SECRET = await loadOrCreateAuthSecret(input.userDataDir);
  env.AUTH_RATE_LIMIT_BACKEND ??= "memory";
  env.AUTH_EXPOSE_VERIFICATION_LINK ??= "true";

  return env;
}

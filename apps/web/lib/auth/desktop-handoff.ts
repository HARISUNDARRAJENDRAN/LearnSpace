import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const desktopFlowPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const desktopVerifierPattern = /^[A-Za-z0-9_-]{43}$/;
const handoffTtlSeconds = 10 * 60;

export type DesktopAuthHandoff =
  | { status: "success"; token: string; maxAge: number; destination: string }
  | { status: "error"; message: string };

type StoredDesktopAuthHandoff = {
  verifierHash: string;
  result?: DesktopAuthHandoff & { codeHash: string };
};

const memoryHandoffs = new Map<string, { expiresAt: number; value: StoredDesktopAuthHandoff }>();

const issueCodeScript = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local stored = cjson.decode(raw)
if stored.result then return 0 end
local result = cjson.decode(ARGV[2])
result.codeHash = ARGV[1]
stored.result = result
redis.call("SET", KEYS[1], cjson.encode(stored), "EX", ARGV[3], "XX")
return 1
`;

const redeemCodeScript = `
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local stored = cjson.decode(raw)
if stored.verifierHash ~= ARGV[1] or not stored.result or stored.result.codeHash ~= ARGV[2] then return nil end
local result = stored.result
redis.call("DEL", KEYS[1])
if result.status == "error" then return cjson.encode({status = "error", message = result.message}) end
return cjson.encode({status = "success", token = result.token, maxAge = result.maxAge, destination = result.destination})
`;

export function validDesktopFlowId(value: string | null | undefined): value is string {
  return typeof value === "string" && desktopFlowPattern.test(value);
}

export function validDesktopVerifier(value: string | null | undefined): value is string {
  return typeof value === "string" && desktopVerifierPattern.test(value);
}

function verifierHash(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function codeHash(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

function safeVerifierMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

function handoffKey(flowId: string): string {
  return `learnspace:desktop-auth:${flowId}`;
}

async function redisCommand(command: string[]): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error("Redis REST is not configured for desktop authentication.");
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Desktop authentication store failed with ${response.status}.`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("result" in body)) {
    throw new Error("Desktop authentication store returned an invalid response.");
  }
  return (body as { result: unknown }).result;
}

export async function startDesktopAuthHandoff(flowId: string, verifier: string): Promise<boolean> {
  if (!validDesktopFlowId(flowId) || !validDesktopVerifier(verifier)) return false;
  const stored: StoredDesktopAuthHandoff = { verifierHash: verifierHash(verifier) };
  if (!redisConfig() && process.env.NODE_ENV !== "production") {
    if (memoryHandoffs.has(flowId)) return false;
    memoryHandoffs.set(flowId, { expiresAt: Date.now() + handoffTtlSeconds * 1000, value: stored });
    return true;
  }
  return await redisCommand([
    "SET",
    handoffKey(flowId),
    JSON.stringify(stored),
    "EX",
    String(handoffTtlSeconds),
    "NX",
  ]) === "OK";
}

export async function writeDesktopAuthHandoff(
  flowId: string,
  result: DesktopAuthHandoff,
): Promise<string | null> {
  if (!validDesktopFlowId(flowId)) return null;
  const code = randomBytes(32).toString("base64url");
  const codeDigest = codeHash(code);
  if (!redisConfig() && process.env.NODE_ENV !== "production") {
    const stored = memoryHandoffs.get(flowId);
    if (!stored || stored.expiresAt <= Date.now() || stored.value.result) return null;
    memoryHandoffs.set(flowId, {
      expiresAt: stored.expiresAt,
      value: { ...stored.value, result: { ...result, codeHash: codeDigest } },
    });
    return code;
  }
  const issued = await redisCommand([
    "EVAL",
    issueCodeScript,
    "1",
    handoffKey(flowId),
    codeDigest,
    JSON.stringify(result),
    String(handoffTtlSeconds),
  ]);
  return issued === 1 ? code : null;
}

export async function redeemDesktopAuthHandoff(
  flowId: string,
  verifier: string,
  code: string,
): Promise<DesktopAuthHandoff | null> {
  if (
    !validDesktopFlowId(flowId) || !validDesktopVerifier(verifier) ||
    !desktopVerifierPattern.test(code)
  ) return null;
  const expectedCodeHash = codeHash(code);
  if (!redisConfig() && process.env.NODE_ENV !== "production") {
    const stored = memoryHandoffs.get(flowId);
    if (
      !stored || stored.expiresAt <= Date.now() || !stored.value.result ||
      !safeVerifierMatch(stored.value.verifierHash, verifierHash(verifier)) ||
      !safeVerifierMatch(stored.value.result.codeHash, expectedCodeHash)
    ) return null;
    const result = stored.value.result;
    memoryHandoffs.delete(flowId);
    return publicHandoff(result);
  }

  const raw = await redisCommand([
    "EVAL",
    redeemCodeScript,
    "1",
    handoffKey(flowId),
    verifierHash(verifier),
    expectedCodeHash,
  ]);
  if (typeof raw !== "string") return null;
  return publicHandoff(JSON.parse(raw));
}

function publicHandoff(value: unknown): DesktopAuthHandoff | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (result.status === "error" && typeof result.message === "string") {
    return { status: "error", message: result.message };
  }
  if (
    result.status === "success" &&
    typeof result.token === "string" && result.token.length >= 40 &&
    typeof result.maxAge === "number" && Number.isSafeInteger(result.maxAge) && result.maxAge > 0 &&
    typeof result.destination === "string" && result.destination.startsWith("/")
  ) {
    return {
      status: "success",
      token: result.token,
      maxAge: result.maxAge,
      destination: result.destination,
    };
  }
  return null;
}

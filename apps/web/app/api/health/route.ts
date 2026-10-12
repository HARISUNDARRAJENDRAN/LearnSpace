import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getAuthDatabase, getDatabase } from "@learnspace/db";
import { privateStorageReady } from "@learnspace/shared/private-storage";
import { redisCommands } from "@learnspace/shared/recommendation-cache";
import { assertEmailDeliveryConfigured, getAppBaseUrl, getAuthSecret, getGoogleConfig } from "../../../lib/auth/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function databaseReady(getDatabaseClient: () => ReturnType<typeof getDatabase>): Promise<boolean> {
  try {
    await getDatabaseClient().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

function authenticationReady(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (
    process.env.AUTH_TEST_MODE === "true" ||
    process.env.AUTH_EXPOSE_VERIFICATION_LINK === "true" ||
    process.env.AUTH_SECURE_COOKIES === "false"
  ) return false;
  try {
    getAuthSecret();
    const appUrl = getAppBaseUrl();
    getGoogleConfig(new Request(`${appUrl}/api/auth/google`));
    assertEmailDeliveryConfigured();
    return true;
  } catch {
    return false;
  }
}

async function redisReady(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production" && (process.env.REDIS_URL || process.env.KV_URL)) {
    return (await redisCommands([["PING"]]))?.[0] === "PONG";
  }

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return false;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: '["PING"]',
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const result: unknown = (await response.json()).result;
    return result === "PONG";
  } catch {
    return false;
  }
}

async function discoveryAgentReady(): Promise<boolean> {
  const baseUrl = process.env.SOURCE_DISCOVERY_AGENT_URL ?? process.env.DISCOVERY_AGENT_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!baseUrl || !token) return false;

  try {
    const readiness = await fetch(new URL("/readyz", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!readiness.ok) return false;

    const response = await fetch(new URL("/internal/v1/discovery/version", baseUrl), {
      headers: { "x-internal-service-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const version: unknown = await response.json();
    return Boolean(
      version && typeof version === "object" &&
      "protocolVersion" in version && version.protocolVersion === "source-discovery-v3" &&
      "schemaVersion" in version && version.schemaVersion === "1",
    );
  } catch {
    return false;
  }
}

export async function GET() {
  const [database, authDatabase, authentication, redis, discoveryAgent, objectStorage] = await Promise.all([
    databaseReady(getDatabase),
    databaseReady(getAuthDatabase),
    authenticationReady(),
    redisReady(),
    discoveryAgentReady(),
    privateStorageReady(),
  ]);
  const ready = database && authDatabase && authentication && redis && discoveryAgent &&
    (process.env.NODE_ENV !== "production" || objectStorage);
  return NextResponse.json(
    {
      status: ready ? "ok" : "not_ready",
      dependencies: { database, authDatabase, authentication, redis, discoveryAgent, objectStorage },
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

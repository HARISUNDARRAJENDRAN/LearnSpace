import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema/index.js";

const databaseEnv = z.object({
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().nonnegative().default(20),
  DB_MAX_LIFETIME_SECONDS: z.coerce.number().int().positive().default(3600),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(500),
  DB_PREPARED_STATEMENTS: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  DB_QUERY_LOGGING: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export const env = databaseEnv.parse(process.env);

export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  connect_timeout: env.DB_CONNECT_TIMEOUT_SECONDS,
  idle_timeout: env.DB_IDLE_TIMEOUT_SECONDS,
  max_lifetime: env.DB_MAX_LIFETIME_SECONDS,
  prepare: env.DB_PREPARED_STATEMENTS,
  connection: {
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    lock_timeout: env.DB_LOCK_TIMEOUT_MS,
  },
  transform: { undefined: null },
});

export const db = drizzle(sqlClient, {
  schema,
  logger: env.DB_QUERY_LOGGING,
});

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

export async function withUserTransaction<T>(
  userId: string,
  operation: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return operation(tx);
  });
}

export async function closeDb(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}

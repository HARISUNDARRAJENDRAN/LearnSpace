import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema/index.js";

const databaseEnv = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_AUTH_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().nonnegative().default(20),
  DB_MAX_LIFETIME_SECONDS: z.coerce.number().int().positive().default(3600),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(500),
  DB_PREPARED_STATEMENTS: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  DB_QUERY_LOGGING: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

type DatabaseEnv = z.infer<typeof databaseEnv>;
type SqlClient = ReturnType<typeof postgres>;

function createDatabase(client: SqlClient, logger: boolean) {
  return drizzle(client, {
    schema,
    logger,
  });
}

export type Database = ReturnType<typeof createDatabase>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

type DatabaseRuntime = {
  env: DatabaseEnv;
  sqlClient: SqlClient;
  authSqlClient: SqlClient;
  db: Database;
  authDb: Database;
};

let runtime: DatabaseRuntime | undefined;

function getRuntime(): DatabaseRuntime {
  if (runtime) {
    return runtime;
  }

  const env = databaseEnv.parse(process.env);
  const clientOptions = {
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
  };
  const sqlClient = postgres(env.DATABASE_URL, clientOptions);
  const authSqlClient = postgres(env.DATABASE_AUTH_URL, clientOptions);

  runtime = {
    env,
    sqlClient,
    authSqlClient,
    db: createDatabase(sqlClient, env.DB_QUERY_LOGGING),
    authDb: createDatabase(authSqlClient, env.DB_QUERY_LOGGING),
  };

  return runtime;
}

export function getDatabase(): Database {
  return getRuntime().db;
}

export function getAuthDatabase(): Database {
  return getRuntime().authDb;
}

export async function withUserTransaction<T>(
  userId: string,
  operation: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return operation(tx);
  });
}

export async function closeDb(): Promise<void> {
  if (!runtime) {
    return;
  }

  await Promise.all([
    runtime.sqlClient.end({ timeout: 5 }),
    runtime.authSqlClient.end({ timeout: 5 }),
  ]);
  runtime = undefined;
}

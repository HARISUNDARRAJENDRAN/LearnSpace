import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema/index.js";

const isServerless =
  process.env.VERCEL === "1" ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
  "Cloudflare" in globalThis;

function usesTransactionPooler(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    return url.port === "6543";
  } catch {
    return false;
  }
}

const databaseEnv = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_AUTH_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(isServerless ? 3 : 6),
  DB_AUTH_POOL_MAX: z.coerce.number().int().positive().default(isServerless ? 2 : 3),
  DB_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().nonnegative().default(isServerless ? 10 : 20),
  DB_MAX_LIFETIME_SECONDS: z.coerce.number().int().positive().default(isServerless ? 300 : 3600),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(500),
  DB_PREPARED_STATEMENTS: z.enum(["true", "false"]).optional().transform((value) => (value === undefined ? undefined : value === "true")),
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
  const baseOptions = {
    connect_timeout: env.DB_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: env.DB_IDLE_TIMEOUT_SECONDS,
    max_lifetime: env.DB_MAX_LIFETIME_SECONDS,
    transform: { undefined: null },
  };
  const appTxPooler = usesTransactionPooler(env.DATABASE_URL);
  const authTxPooler = usesTransactionPooler(env.DATABASE_AUTH_URL);
  const sqlClient = postgres(env.DATABASE_URL, {
    ...baseOptions,
    max: env.DB_POOL_MAX,
    // Supavisor transaction mode (:6543) does not support session-level prepared statements.
    prepare: env.DB_PREPARED_STATEMENTS ?? !appTxPooler,
    connection: {
      application_name: "learnspace-web",
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      lock_timeout: env.DB_LOCK_TIMEOUT_MS,
    },
  });
  const authSqlClient = postgres(env.DATABASE_AUTH_URL, {
    ...baseOptions,
    max: env.DB_AUTH_POOL_MAX,
    prepare: env.DB_PREPARED_STATEMENTS ?? !authTxPooler,
    connection: {
      application_name: "learnspace-auth",
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      lock_timeout: env.DB_LOCK_TIMEOUT_MS,
    },
  });

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Whether `value` is a UUID, and so safe to write into a statement as a literal. A statement with bind parameters costs
 * postgres.js two round trips (drizzle's queries are never prepared, so it describes each one first); one without, one.
 */
export const isUuid = (value: string): boolean => UUID.test(value);

export async function withUserTransaction<T>(
  userId: string,
  operation: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    // A user id that is a UUID, as every user id is, can only be its own literal, so it is sent without bind parameters, in
    // one round trip (see isUuid). Anything else is still bound.
    await tx.execute(isUuid(userId)
      ? sql.raw(`select set_config('app.user_id', '${userId.toLowerCase()}', true)`)
      : sql`select set_config('app.user_id', ${userId}, true)`);
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

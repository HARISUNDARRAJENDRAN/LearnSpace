import postgres from "postgres";

const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!adminUrl) {
  throw new Error("DATABASE_ADMIN_URL is required for remote database bootstrap");
}

const roles = [
  ["learnspace_migrator", "LEARNSPACE_MIGRATOR_PASSWORD"],
  ["learnspace_app", "LEARNSPACE_APP_PASSWORD"],
  ["learnspace_auth", "LEARNSPACE_AUTH_PASSWORD"],
  ["learnspace_ai", "LEARNSPACE_AI_PASSWORD"],
  ["learnspace_worker", "LEARNSPACE_WORKER_PASSWORD"],
  ["learnspace_runner", "LEARNSPACE_RUNNER_PASSWORD"],
  ["learnspace_readonly", "LEARNSPACE_READONLY_PASSWORD"],
] as const;

const runtimeRoles = [
  "learnspace_app",
  "learnspace_auth",
  "learnspace_ai",
  "learnspace_worker",
  "learnspace_runner",
  "learnspace_readonly",
] as const;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const roleStatements = roles.map(([roleName, passwordEnv], index) => {
  const password = process.env[passwordEnv];
  if (!password) {
    throw new Error(`${passwordEnv} is required for remote database bootstrap`);
  }

  const identifier = quoteIdentifier(roleName);
  const literal = quoteLiteral(password);
  return `
DO $learnspace_role_${index}$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(roleName)}) THEN
    CREATE ROLE ${identifier} LOGIN PASSWORD ${literal} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE ${identifier} PASSWORD ${literal};
  END IF;
END
$learnspace_role_${index}$;`;
}).join("\n");

const runtimeRoleList = runtimeRoles.map(quoteIdentifier).join(", ");

const sql = postgres(adminUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  connection: {
    statement_timeout: 10_000,
    lock_timeout: 5_000,
  },
});

try {
  await sql.unsafe(roleStatements);

  await sql.unsafe(`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
`);

  const [database] = await sql<{ name: string }[]>`SELECT current_database() AS name`;
  if (!database) {
    throw new Error("Could not determine the remote database name");
  }

  const databaseIdentifier = quoteIdentifier(database.name);
  await sql.unsafe(`
GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${quoteIdentifier("learnspace_migrator")}, ${runtimeRoleList};
GRANT CREATE ON DATABASE ${databaseIdentifier} TO ${quoteIdentifier("learnspace_migrator")};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ${quoteIdentifier("learnspace_migrator")}, ${runtimeRoleList};
GRANT USAGE ON TYPE public.vector TO ${quoteIdentifier("learnspace_migrator")}, ${runtimeRoleList.replace(", \"learnspace_auth\"", "")};
`);

  await sql.unsafe(`
DO $learnspace_vector_grants$
DECLARE
  vector_function record;
BEGIN
  FOR vector_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_depend AS d
      ON d.classid = 'pg_proc'::regclass
     AND d.objid = p.oid
     AND d.refclassid = 'pg_extension'::regclass
    JOIN pg_extension AS e ON e.oid = d.refobjid
    WHERE e.extname = 'vector'
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly',
      vector_function.signature
    );
  END LOOP;
END;
$learnspace_vector_grants$;
`);

  await sql.unsafe(`
ALTER ROLE learnspace_app SET statement_timeout = '3s';
ALTER ROLE learnspace_app SET lock_timeout = '500ms';
ALTER ROLE learnspace_auth SET statement_timeout = '3s';
ALTER ROLE learnspace_auth SET lock_timeout = '500ms';
ALTER ROLE learnspace_ai SET statement_timeout = '5s';
ALTER ROLE learnspace_worker SET statement_timeout = '30s';
ALTER ROLE learnspace_runner SET statement_timeout = '10s';
ALTER ROLE learnspace_readonly SET default_transaction_read_only = on;
`);

  process.stdout.write("Remote database bootstrap complete.\n");
} finally {
  await sql.end({ timeout: 5 });
}

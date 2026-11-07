import postgres from "postgres";

const databaseUrl = process.env.DATABASE_ADMIN_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_ADMIN_URL is required");
}

const parsed = new URL(databaseUrl);
const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const allowedPorts = new Set(["5432", "55432", "55433"]);

if (!allowedHosts.has(parsed.hostname) || (parsed.port !== "" && !allowedPorts.has(parsed.port))) {
  throw new Error("db:reset:local only accepts a local PostgreSQL URL");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

try {
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS identity, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection, drizzle CASCADE;
  `);
  process.stdout.write("Local LearnSpace database schemas reset.\n");
} finally {
  await sql.end({ timeout: 5 });
}

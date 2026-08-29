import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

async function ensureExtensions(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    await admin.unsafe("CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS vector;");
  } finally {
    await admin.end({ timeout: 5 });
  }
}

const migrationsFolder = fileURLToPath(new URL("../../../../infra/migrations/drizzle", import.meta.url));
const customMigrationsFolder = fileURLToPath(new URL("../../../../infra/migrations/sql", import.meta.url));

async function applyCustomMigrations(): Promise<void> {
  const names = (await readdir(customMigrationsFolder))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const name of names) {
    const contents = await readFile(resolve(customMigrationsFolder, name), "utf8");
    await sql.unsafe(contents);
  }
}

try {
  await sql.unsafe("SELECT pg_advisory_lock(hashtext('learnspace:database-migrations'))");
  await ensureExtensions();
  await migrate(drizzle(sql), { migrationsFolder });
  await applyCustomMigrations();
  process.stdout.write("Database migrations applied.\n");
} finally {
  await sql.unsafe("SELECT pg_advisory_unlock(hashtext('learnspace:database-migrations'))").catch(() => undefined);
  await sql.end({ timeout: 5 });
}

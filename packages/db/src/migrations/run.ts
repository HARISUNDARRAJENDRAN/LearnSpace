import { createHash } from "node:crypto";
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

const migrationsFolder = fileURLToPath(new URL("../../../../infra/migrations/drizzle", import.meta.url));

type DrizzleMigrationRow = { hash: string };
type ManifestRow = { migration_order: number; migration_name: string; checksum: string; drizzle_hash: string };

async function syncMigrationManifest(): Promise<void> {
  const names = (await readdir(migrationsFolder))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const drizzleRows = await sql<DrizzleMigrationRow[]>`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `;
  const manifestRows = await sql<ManifestRow[]>`
    SELECT migration_order, migration_name, checksum, drizzle_hash
    FROM drizzle.migration_manifest
    ORDER BY migration_order
  `;
  if (drizzleRows.length !== names.length) {
    throw new Error(`migration ledger has ${drizzleRows.length} rows for ${names.length} migration files`);
  }
  for (const [migrationOrder, migrationName] of names.entries()) {
    const contents = await readFile(resolve(migrationsFolder, migrationName), "utf8");
    const checksum = createHash("sha256").update(contents).digest("hex");
    const drizzleRow = drizzleRows[migrationOrder];
    if (!drizzleRow) {
      throw new Error(`missing Drizzle ledger row for ${migrationName}`);
    }
    const manifestRow = manifestRows[migrationOrder];
    if (!manifestRow) {
      await sql`
        INSERT INTO drizzle.migration_manifest (migration_order, migration_name, checksum, drizzle_hash)
        VALUES (${migrationOrder}, ${migrationName}, ${checksum}, ${drizzleRow.hash})
      `;
      continue;
    }
    if (
      manifestRow.migration_order !== migrationOrder ||
      manifestRow.migration_name !== migrationName ||
      manifestRow.checksum !== checksum ||
      manifestRow.drizzle_hash !== drizzleRow.hash
    ) {
      throw new Error(`migration manifest mismatch for ${migrationName}`);
    }
  }
  if (manifestRows.length > names.length) {
    throw new Error("migration manifest contains an unknown migration");
  }
}

try {
  await sql.unsafe("SELECT pg_advisory_lock(hashtext('learnspace:database-migrations'))");
  await migrate(drizzle(sql), { migrationsFolder });
  await syncMigrationManifest();
  process.stdout.write("Database migrations applied.\n");
} finally {
  await sql.unsafe("SELECT pg_advisory_unlock(hashtext('learnspace:database-migrations'))").catch(() => undefined);
  await sql.end({ timeout: 5 });
}

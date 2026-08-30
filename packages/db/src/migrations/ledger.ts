import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATOR_URL is required");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

const migrationsFolder = fileURLToPath(new URL("../../../../infra/migrations/drizzle", import.meta.url));

type DrizzleMigrationRow = { hash: string };
type ManifestRow = { migration_order: number; migration_name: string; checksum: string; drizzle_hash: string; applied_at: string };

try {
  const names = (await readdir(migrationsFolder))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const drizzleRows = await sql<DrizzleMigrationRow[]>`
    SELECT hash
    FROM drizzle.__drizzle_migrations
    ORDER BY id
  `;
  const manifestRows = await sql<ManifestRow[]>`
    SELECT migration_order, migration_name, checksum, drizzle_hash, applied_at::text
    FROM drizzle.migration_manifest
    ORDER BY migration_order
  `;
  if (drizzleRows.length !== names.length || manifestRows.length !== names.length) {
    throw new Error("migration ledger and migration files are out of sync");
  }
  const output = [];
  for (const [migrationOrder, migrationName] of names.entries()) {
    const contents = await readFile(resolve(migrationsFolder, migrationName), "utf8");
    const checksum = createHash("sha256").update(contents).digest("hex");
    const drizzleRow = drizzleRows[migrationOrder];
    const manifestRow = manifestRows[migrationOrder];
    if (!drizzleRow || !manifestRow || manifestRow.migration_order !== migrationOrder || manifestRow.migration_name !== migrationName || manifestRow.checksum !== checksum || manifestRow.drizzle_hash !== drizzleRow.hash) {
      throw new Error(`migration ledger mismatch for ${migrationName}`);
    }
    output.push({ order: migrationOrder, name: migrationName, checksum, drizzleHash: drizzleRow.hash });
  }
  process.stdout.write(JSON.stringify(output) + "\n");
} finally {
  await sql.end({ timeout: 5 });
}

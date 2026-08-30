import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_MIGRATOR_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATOR_URL is required for Drizzle Kit");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "../../infra/migrations/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  strict: true,
  verbose: true,
});

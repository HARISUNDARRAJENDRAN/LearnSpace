import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, primaryKey, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { discoverySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { resources } from "../catalog/resources.js";
import { ACTIVE_EMBEDDING_DIMENSIONS } from "../retrieval/embeddings.js";

export const resourceEmbeddings = discoverySchema.table("resource_embeddings", {
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  sourceHash: text("source_hash").notNull(),
  embedding: vector("embedding", { dimensions: ACTIVE_EMBEDDING_DIMENSIONS }),
  attempts: integer("attempts").notNull().default(0),
  retryAt: timestamp("retry_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.resourceId, table.model] }),
  index("resource_embeddings_cosine_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  index("resource_embeddings_retry_idx").on(table.retryAt).where(sql`${table.embedding} IS NULL`),
  check("resource_embeddings_nonzero_chk", sql`${table.embedding} IS NULL OR vector_norm(${table.embedding}) > 0`),
]);

export const learnerProfiles = discoverySchema.table("learner_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

import { sql } from "drizzle-orm";
import { check, halfvec, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { retrievalSchema } from "../namespaces.js";
import { resourceChunks } from "./chunks.js";

export const ACTIVE_EMBEDDING_DIMENSIONS = 1536;

export const embeddingProfiles = retrievalSchema.table(
  "embedding_profiles",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    modelName: text("model_name").notNull(),
    dimensions: integer("dimensions").notNull(),
    distanceMetric: text("distance_metric").notNull().default("cosine"),
    normalization: text("normalization"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("embedding_profiles_provider_model_dimensions_uq").on(table.provider, table.modelName, table.dimensions),
    check("embedding_profiles_dimensions_chk", sql`${table.dimensions} > 0`),
    check("embedding_profiles_active_dimensions_chk", sql`${table.dimensions} = 1536`),
    check("embedding_profiles_distance_metric_chk", sql`${table.distanceMetric} = 'cosine'`),
  ],
);

export const chunkEmbeddings = retrievalSchema.table(
  "chunk_embeddings",
  {
    chunkId: uuid("chunk_id").notNull().references(() => resourceChunks.id, { onDelete: "restrict" }),
    embeddingProfileId: text("embedding_profile_id").notNull().references(() => embeddingProfiles.id, { onDelete: "restrict" }),
    embedding: halfvec("embedding", { dimensions: ACTIVE_EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chunkId, table.embeddingProfileId] }),
  ],
);

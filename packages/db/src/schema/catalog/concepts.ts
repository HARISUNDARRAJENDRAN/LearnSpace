import { sql } from "drizzle-orm";
import { boolean, check, index, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { concepts } from "../knowledge/concepts.js";
import { resources } from "./resources.js";

export const resourceConcepts = catalogSchema.table(
  "resource_concepts",
  {
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    relevance: real("relevance").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    extractorVersion: text("extractor_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceId, table.conceptId, table.source] }),
    index("resource_concepts_concept_relevance_idx").on(table.conceptId, table.relevance.desc()),
    check("resource_concepts_relevance_chk", sql`${table.relevance} BETWEEN 0 AND 1`),
  ],
);

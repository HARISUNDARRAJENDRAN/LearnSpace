import { sql } from "drizzle-orm";
import { check, index, jsonb, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { knowledgeSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { tsvector } from "../types.js";

export const concepts = knowledgeSchema.table(
  "concepts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("active"),
    canonicalParentId: uuid("canonical_parent_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(summary, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("concepts_slug_uq").on(table.slug),
    index("concepts_kind_status_idx").on(table.kind, table.status),
    index("concepts_parent_idx").on(table.canonicalParentId),
    index("concepts_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

export const conceptAliases = knowledgeSchema.table(
  "concept_aliases",
  {
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    locale: text("locale").notNull().default("en"),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conceptId, table.normalizedAlias, table.locale] }),
    index("concept_aliases_normalized_idx").on(table.normalizedAlias),
  ],
);

export const conceptRelations = knowledgeSchema.table(
  "concept_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceConceptId: uuid("source_concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    targetConceptId: uuid("target_concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    weight: real("weight").notNull().default(1),
    confidence: real("confidence").notNull().default(1),
    status: text("status").notNull().default("accepted"),
    createdBy: text("created_by").notNull(),
    extractorVersion: text("extractor_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("concept_relations_identity_uq").on(table.sourceConceptId, table.targetConceptId, table.relationType),
    check("concept_relations_distinct_chk", sql`${table.sourceConceptId} <> ${table.targetConceptId}`),
    check("concept_relations_weight_chk", sql`${table.weight} BETWEEN 0 AND 1`),
    check("concept_relations_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
  ],
);

export const userKnowledgeEdges = knowledgeSchema.table(
  "user_knowledge_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceConceptId: uuid("source_concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    targetConceptId: uuid("target_concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    weight: real("weight").notNull(),
    confidence: real("confidence").notNull(),
    status: text("status").notNull().default("active"),
    lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }).notNull(),
    projectorVersion: text("projector_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_knowledge_edges_identity_uq").on(table.userId, table.sourceConceptId, table.targetConceptId, table.relationType),
    check("user_knowledge_edges_weight_chk", sql`${table.weight} BETWEEN 0 AND 1`),
    check("user_knowledge_edges_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
  ],
);

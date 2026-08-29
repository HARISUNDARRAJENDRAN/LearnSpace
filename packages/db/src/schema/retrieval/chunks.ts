import { sql } from "drizzle-orm";
import { char, check, index, integer, jsonb, primaryKey, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { retrievalSchema } from "../namespaces.js";
import { resourceVersions } from "../catalog/resources.js";
import { concepts } from "../knowledge/concepts.js";
import { tsvector } from "../types.js";

export const resourceChunks = retrievalSchema.table(
  "resource_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceVersionId: uuid("resource_version_id").notNull().references(() => resourceVersions.id, { onDelete: "cascade" }),
    parentChunkId: uuid("parent_chunk_id"),
    ordinal: integer("ordinal").notNull(),
    chunkType: text("chunk_type").notNull(),
    headingPath: text("heading_path").array().notNull().default(sql`'{}'::text[]`),
    content: text("content").notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    tokenCount: integer("token_count").notNull(),
    language: text("language"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    pageFrom: integer("page_from"),
    pageTo: integer("page_to"),
    paragraphFrom: integer("paragraph_from"),
    paragraphTo: integer("paragraph_to"),
    anchor: jsonb("anchor").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(sql`to_tsvector('simple', content)`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_chunks_version_ordinal_uq").on(table.resourceVersionId, table.ordinal),
    uniqueIndex("resource_chunks_version_content_ordinal_uq").on(table.resourceVersionId, table.contentSha256, table.ordinal),
    unique("resource_chunks_version_id_uq").on(table.resourceVersionId, table.id),
    index("resource_chunks_version_start_idx").on(table.resourceVersionId, table.startMs).where(sql`${table.startMs} IS NOT NULL`),
    index("resource_chunks_version_page_idx").on(table.resourceVersionId, table.pageFrom).where(sql`${table.pageFrom} IS NOT NULL`),
    index("resource_chunks_parent_idx").on(table.parentChunkId),
    check("resource_chunks_token_count_chk", sql`${table.tokenCount} > 0`),
    check("resource_chunks_start_ms_chk", sql`${table.startMs} IS NULL OR ${table.startMs} >= 0`),
    check("resource_chunks_end_ms_chk", sql`${table.endMs} IS NULL OR (${table.startMs} IS NOT NULL AND ${table.endMs} >= ${table.startMs})`),
    check("resource_chunks_page_from_chk", sql`${table.pageFrom} IS NULL OR ${table.pageFrom} >= 1`),
    check("resource_chunks_page_to_chk", sql`${table.pageTo} IS NULL OR (${table.pageFrom} IS NOT NULL AND ${table.pageTo} >= ${table.pageFrom})`),
    check("resource_chunks_paragraph_from_chk", sql`${table.paragraphFrom} IS NULL OR ${table.paragraphFrom} >= 1`),
    check("resource_chunks_paragraph_to_chk", sql`${table.paragraphTo} IS NULL OR (${table.paragraphFrom} IS NOT NULL AND ${table.paragraphTo} >= ${table.paragraphFrom})`),
  ],
);

export const chunkConcepts = retrievalSchema.table(
  "chunk_concepts",
  {
    chunkId: uuid("chunk_id").notNull().references(() => resourceChunks.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    confidence: real("confidence").notNull(),
    source: text("source").notNull(),
    extractorVersion: text("extractor_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chunkId, table.conceptId, table.relationType, table.source] }),
    index("chunk_concepts_concept_confidence_idx").on(table.conceptId, table.confidence.desc()),
    check("chunk_concepts_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
  ],
);

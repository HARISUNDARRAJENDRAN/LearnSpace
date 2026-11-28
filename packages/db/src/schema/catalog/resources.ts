import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, jsonb, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { resourceStatus, resourceType, resourceVisibility } from "../domain-values.js";
import { users } from "../identity/users.js";
import { tsvector } from "../types.js";

export const resources = catalogSchema.table(
  "resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "restrict" }),
    type: resourceType("type").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    canonicalUrl: text("canonical_url"),
    title: text("title").notNull(),
    description: text("description"),
    language: text("language"),
    visibility: resourceVisibility("visibility").notNull().default("private"),
    status: resourceStatus("status").notNull().default("pending"),
    currentVersionId: uuid("current_version_id"),
    qualityScore: real("quality_score"),
    thumbnailObjectKey: text("thumbnail_object_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(${sql.raw("title")}, '') || ' ' || coalesce(${sql.raw("description")}, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("resources_provider_external_global_uq")
      .on(table.provider, table.externalId)
      .where(sql`${table.ownerUserId} IS NULL AND ${table.externalId} IS NOT NULL`),
    uniqueIndex("resources_owner_provider_external_uq")
      .on(table.ownerUserId, table.provider, table.externalId)
      .where(sql`${table.ownerUserId} IS NOT NULL AND ${table.externalId} IS NOT NULL`),
    index("resources_owner_updated_idx").on(table.ownerUserId, table.updatedAt.desc()),
    index("resources_type_status_quality_idx").on(table.type, table.status, table.qualityScore.desc()),
    index("resources_visibility_status_idx").on(table.visibility, table.status),
    index("resources_public_ready_updated_idx")
      .on(table.type, table.updatedAt, table.id)
      .where(sql`${table.ownerUserId} IS NULL AND ${table.status} = 'ready' AND ${table.deletedAt} IS NULL`),
    index("resources_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    check(
      "resources_quality_score_chk",
      sql`${table.qualityScore} IS NULL OR (${table.qualityScore} >= 0 AND ${table.qualityScore} <= 1)`,
    ),
  ],
);

export const resourceVersions = catalogSchema.table(
  "resource_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    sourceSha256: char("source_sha256", { length: 64 }).notNull(),
    contentSha256: char("content_sha256", { length: 64 }),
    sourceEtag: text("source_etag"),
    sourceLastModified: timestamp("source_last_modified", { withTimezone: true }),
    rawObjectKey: text("raw_object_key").notNull(),
    normalizedObjectKey: text("normalized_object_key"),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }),
    parserName: text("parser_name"),
    parserVersion: text("parser_version"),
    extractionVersion: integer("extraction_version").notNull().default(1),
    processingStatus: text("processing_status").notNull(),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_versions_resource_version_uq").on(table.resourceId, table.versionNo),
    uniqueIndex("resource_versions_resource_source_hash_uq").on(table.resourceId, table.sourceSha256),
    unique("resource_versions_resource_id_id_uq").on(table.resourceId, table.id),
    check("resource_versions_version_no_chk", sql`${table.versionNo} > 0`),
  ],
);

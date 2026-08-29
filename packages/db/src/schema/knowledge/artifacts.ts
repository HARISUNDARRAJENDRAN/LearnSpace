import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { knowledgeSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { resources, resourceVersions } from "../catalog/resources.js";
import { resourceChunks } from "../retrieval/chunks.js";
import { studySessions } from "../study/sessions.js";
import { concepts } from "./concepts.js";

export const artifactDetails = knowledgeSchema.table(
  "artifact_details",
  {
    resourceId: uuid("resource_id").primaryKey().references(() => resources.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "restrict" }),
    artifactType: text("artifact_type").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    sourceAgentRunId: uuid("source_agent_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("artifact_details_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    index("artifact_details_session_created_idx").on(table.studySessionId, table.createdAt),
    foreignKey({
      name: "artifact_details_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
  ],
);

export const artifactSources = knowledgeSchema.table(
  "artifact_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artifactResourceId: uuid("artifact_resource_id").notNull(),
    sourceResourceId: uuid("source_resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    sourceVersionId: uuid("source_version_id").notNull().references(() => resourceVersions.id, { onDelete: "restrict" }),
    sourceChunkId: uuid("source_chunk_id").references(() => resourceChunks.id, { onDelete: "restrict" }),
    relationType: text("relation_type").notNull(),
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    confidence: real("confidence").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("artifact_sources_identity_uq").on(
      table.artifactResourceId,
      table.sourceVersionId,
      sql`coalesce(${table.sourceChunkId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.relationType,
    ),
    check("artifact_sources_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
    foreignKey({
      name: "artifact_sources_artifact_fkey",
      columns: [table.artifactResourceId],
      foreignColumns: [artifactDetails.resourceId],
    }).onDelete("restrict"),
    foreignKey({
      name: "artifact_sources_resource_version_fkey",
      columns: [table.sourceResourceId, table.sourceVersionId],
      foreignColumns: [resourceVersions.resourceId, resourceVersions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "artifact_sources_version_chunk_fkey",
      columns: [table.sourceVersionId, table.sourceChunkId],
      foreignColumns: [resourceChunks.resourceVersionId, resourceChunks.id],
    }).onDelete("restrict"),
  ],
);

export const artifactConcepts = knowledgeSchema.table(
  "artifact_concepts",
  {
    artifactResourceId: uuid("artifact_resource_id").notNull(),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "restrict" }),
    relationType: text("relation_type").notNull(),
    confidence: real("confidence").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "artifact_concepts_pk", columns: [table.artifactResourceId, table.conceptId, table.relationType, table.source] }),
    index("artifact_concepts_concept_confidence_idx").on(table.conceptId, table.confidence.desc()),
    check("artifact_concepts_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
    foreignKey({
      name: "artifact_concepts_artifact_fkey",
      columns: [table.artifactResourceId],
      foreignColumns: [artifactDetails.resourceId],
    }).onDelete("restrict"),
  ],
);

import { sql } from "drizzle-orm";
import { boolean, char, check, foreignKey, index, integer, jsonb, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { practiceSchema } from "../namespaces.js";
import { exerciseKind } from "../domain-values.js";
import { users } from "../identity/users.js";
import { concepts } from "../knowledge/concepts.js";
import { resources, resourceVersions } from "../catalog/resources.js";
import { resourceChunks } from "../retrieval/chunks.js";
import { studySessions } from "../study/sessions.js";

export const exercises = practiceSchema.table(
  "exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: exerciseKind("kind").notNull(),
    canonicalConceptId: uuid("canonical_concept_id").references(() => concepts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("exercises_concept_status_idx").on(table.canonicalConceptId, table.status)],
);

export const exerciseVersions = practiceSchema.table(
  "exercise_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    language: text("language"),
    runtimeFamily: text("runtime_family"),
    difficulty: text("difficulty"),
    promptMd: text("prompt_md").notNull(),
    starterCode: text("starter_code"),
    functionSignature: text("function_signature"),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    solutionOutline: text("solution_outline"),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    generatorModel: text("generator_model"),
    generatorVersion: text("generator_version"),
    validationStatus: text("validation_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("exercise_versions_exercise_version_uq").on(table.exerciseId, table.versionNo),
    uniqueIndex("exercise_versions_exercise_content_hash_uq").on(table.exerciseId, table.contentSha256),
    check("exercise_versions_version_no_chk", sql`${table.versionNo} > 0`),
  ],
);

export const exerciseBindings = practiceSchema.table(
  "exercise_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseVersionId: uuid("exercise_version_id").notNull().references(() => exerciseVersions.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "cascade" }),
    resourceVersionId: uuid("resource_version_id").references(() => resourceVersions.id, { onDelete: "cascade" }),
    resourceChunkId: uuid("resource_chunk_id").references(() => resourceChunks.id, { onDelete: "set null" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    gatePosition: integer("gate_position"),
    required: boolean("required").notNull().default(true),
    triggerReason: text("trigger_reason"),
    confidence: real("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("exercise_bindings_context_chk", sql`${table.studySessionId} IS NOT NULL OR ${table.resourceId} IS NOT NULL OR ${table.resourceChunkId} IS NOT NULL OR ${table.conceptId} IS NOT NULL`),
    check("exercise_bindings_version_resource_pair_chk", sql`${table.resourceVersionId} IS NULL OR ${table.resourceId} IS NOT NULL`),
    check("exercise_bindings_chunk_version_pair_chk", sql`${table.resourceChunkId} IS NULL OR ${table.resourceVersionId} IS NOT NULL`),
    check("exercise_bindings_time_span_chk", sql`${table.endMs} IS NULL OR (${table.startMs} IS NOT NULL AND ${table.endMs} >= ${table.startMs})`),
    check("exercise_bindings_confidence_chk", sql`${table.confidence} IS NULL OR ${table.confidence} BETWEEN 0 AND 1`),
    index("exercise_bindings_session_gate_idx").on(table.studySessionId, table.gatePosition),
    index("exercise_bindings_resource_start_idx").on(table.resourceId, table.startMs),
    index("exercise_bindings_concept_idx").on(table.conceptId),
    unique("exercise_bindings_version_id_uq").on(table.exerciseVersionId, table.id),
    foreignKey({
      name: "exercise_bindings_resource_version_fkey",
      columns: [table.resourceId, table.resourceVersionId],
      foreignColumns: [resourceVersions.resourceId, resourceVersions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "exercise_bindings_version_chunk_fkey",
      columns: [table.resourceVersionId, table.resourceChunkId],
      foreignColumns: [resourceChunks.resourceVersionId, resourceChunks.id],
    }),
  ],
);

export const exerciseExamples = practiceSchema.table(
  "exercise_examples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseVersionId: uuid("exercise_version_id").notNull().references(() => exerciseVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    inputText: text("input_text"),
    expectedOutputText: text("expected_output_text"),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("exercise_examples_version_ordinal_uq").on(table.exerciseVersionId, table.ordinal)],
);

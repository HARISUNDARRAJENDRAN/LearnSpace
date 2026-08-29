import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, primaryKey, real, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { knowledgeSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { activityEvents } from "../activity/events.js";
import { resources } from "../catalog/resources.js";
import { resourceChunks } from "../retrieval/chunks.js";
import { studySessions } from "../study/sessions.js";
import { concepts } from "./concepts.js";

export const masterySignals = knowledgeSchema.table(
  "mastery_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    sourceEventId: uuid("source_event_id").notNull().references(() => activityEvents.id, { onDelete: "restrict" }),
    signalType: text("signal_type").notNull(),
    value: real("value").notNull(),
    reliability: real("reliability").notNull(),
    weight: real("weight").notNull().default(1),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    projectorVersion: text("projector_version").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mastery_signals_identity_uq").on(table.userId, table.conceptId, table.sourceEventId, table.signalType),
    check("mastery_signals_value_chk", sql`${table.value} BETWEEN -1 AND 1`),
    check("mastery_signals_reliability_chk", sql`${table.reliability} BETWEEN 0 AND 1`),
    check("mastery_signals_weight_chk", sql`${table.weight} BETWEEN 0 AND 1`),
    index("mastery_signals_user_concept_observed_idx").on(table.userId, table.conceptId, table.observedAt.desc()),
    index("mastery_signals_source_event_idx").on(table.sourceEventId),
  ],
);

export const conceptMastery = knowledgeSchema.table(
  "concept_mastery",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    uncertainty: real("uncertainty").notNull(),
    stage: text("stage").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    positiveEvidence: real("positive_evidence").notNull(),
    negativeEvidence: real("negative_evidence").notNull(),
    lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    decayRate: real("decay_rate"),
    projectorVersion: text("projector_version").notNull(),
    projectionVersion: integer("projection_version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.conceptId] }),
    check("concept_mastery_score_chk", sql`${table.score} BETWEEN 0 AND 1`),
    check("concept_mastery_uncertainty_chk", sql`${table.uncertainty} BETWEEN 0 AND 1`),
    index("concept_mastery_user_next_review_idx").on(table.userId, table.nextReviewAt).where(sql`${table.nextReviewAt} IS NOT NULL`),
    index("concept_mastery_user_score_uncertainty_idx").on(table.userId, table.score, table.uncertainty),
  ],
);

export const reviewSchedules = knowledgeSchema.table(
  "review_schedules",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    algorithm: text("algorithm").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
    lastResult: text("last_result"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.conceptId] }),
    index("review_schedules_user_next_review_idx").on(table.userId, table.nextReviewAt),
  ],
);

export const unresolvedQuestions = knowledgeSchema.table(
  "unresolved_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    resourceChunkId: uuid("resource_chunk_id").references(() => resourceChunks.id, { onDelete: "set null" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    status: text("status").notNull().default("open"),
    priority: smallint("priority").notNull().default(0),
    resolvedByArtifact: uuid("resolved_by_artifact").references(() => resources.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("unresolved_questions_user_status_updated_idx").on(table.userId, table.status, table.updatedAt.desc()),
    index("unresolved_questions_session_status_idx").on(table.studySessionId, table.status),
  ],
);

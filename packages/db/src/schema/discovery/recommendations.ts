import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { discoverySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { resources } from "../catalog/resources.js";
import { studySessions } from "../study/sessions.js";

export const recommendationRuns = discoverySchema.table(
  "recommendation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    surface: text("surface").notNull(),
    queryText: text("query_text"),
    strategyVersion: text("strategy_version").notNull(),
    featureVersion: text("feature_version").notNull(),
    contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("recommendation_runs_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("recommendation_runs_surface_created_idx").on(table.surface, table.createdAt.desc()),
  ],
);

export const recommendationCandidates = discoverySchema.table(
  "recommendation_candidates",
  {
    recommendationRunId: uuid("recommendation_run_id").notNull().references(() => recommendationRuns.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    candidateRank: integer("candidate_rank").notNull(),
    finalRank: integer("final_rank"),
    score: real("score").notNull(),
    semanticRelevance: real("semantic_relevance"),
    qualityScore: real("quality_score"),
    learnerAffinity: real("learner_affinity"),
    masteryFit: real("mastery_fit"),
    coverageScore: real("coverage_score"),
    freshnessScore: real("freshness_score"),
    diversityPenalty: real("diversity_penalty"),
    reasonCodes: jsonb("reason_codes").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    selected: boolean("selected").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.recommendationRunId, table.resourceId] }),
    uniqueIndex("recommendation_candidates_run_candidate_rank_uq").on(table.recommendationRunId, table.candidateRank),
    uniqueIndex("recommendation_candidates_run_final_rank_uq").on(table.recommendationRunId, table.finalRank).where(sql`${table.finalRank} IS NOT NULL`),
  ],
);

export const recommendationImpressions = discoverySchema.table(
  "recommendation_impressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recommendationRunId: uuid("recommendation_run_id").notNull().references(() => recommendationRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    surface: text("surface").notNull(),
    shownAt: timestamp("shown_at", { withTimezone: true }).notNull().defaultNow(),
    visibleDurationMs: integer("visible_duration_ms"),
    traceId: text("trace_id"),
  },
  (table) => [
    uniqueIndex("recommendation_impressions_run_resource_position_uq").on(table.recommendationRunId, table.resourceId, table.position),
    index("recommendation_impressions_user_shown_idx").on(table.userId, table.shownAt.desc()),
  ],
);

export const discoveryInteractions = discoverySchema.table(
  "discovery_interactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    impressionId: uuid("impression_id").references(() => recommendationImpressions.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: uuid("correlation_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    index("discovery_interactions_user_occurred_idx").on(table.userId, table.occurredAt.desc()),
    index("discovery_interactions_resource_action_occurred_idx").on(table.resourceId, table.action, table.occurredAt.desc()),
  ],
);

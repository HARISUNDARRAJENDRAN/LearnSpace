import { sql } from "drizzle-orm";
import { check, index, jsonb, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { discoverySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { concepts } from "../knowledge/concepts.js";
import { resources } from "../catalog/resources.js";
import { authors } from "../catalog/papers.js";

export const userConceptAffinity = discoverySchema.table(
  "user_concept_affinity",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    confidence: real("confidence").notNull(),
    positiveWeight: real("positive_weight").notNull().default(0),
    negativeWeight: real("negative_weight").notNull().default(0),
    featureVersion: text("feature_version").notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.conceptId] }),
    check("user_concept_affinity_score_chk", sql`${table.score} BETWEEN -1 AND 1`),
    check("user_concept_affinity_confidence_chk", sql`${table.confidence} BETWEEN 0 AND 1`),
    index("user_concept_affinity_user_score_idx").on(table.userId, table.score.desc()),
  ],
);

export const favoriteAuthors = discoverySchema.table(
  "favorite_authors",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => authors.id, { onDelete: "cascade" }),
    followedAt: timestamp("followed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.authorId] }),
    index("favorite_authors_user_followed_idx").on(table.userId, table.followedAt.desc()),
  ],
);

export const resourceQualitySnapshots = discoverySchema.table(
  "resource_quality_snapshots",
  {
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    featureVersion: text("feature_version").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    bayesianEngagement: real("bayesian_engagement"),
    commentQuality: real("comment_quality"),
    completionRate: real("completion_rate"),
    retentionRate: real("retention_rate"),
    freshnessPrior: real("freshness_prior"),
    contentCoverage: real("content_coverage"),
    sourceAuthority: real("source_authority"),
    finalQualityScore: real("final_quality_score").notNull(),
    features: jsonb("features").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    primaryKey({ name: "resource_quality_snapshots_pk", columns: [table.resourceId, table.featureVersion, table.capturedAt] }),
    check("resource_quality_snapshots_score_chk", sql`${table.finalQualityScore} BETWEEN 0 AND 1`),
    index("resource_quality_snapshots_version_score_idx").on(table.featureVersion, table.finalQualityScore.desc(), table.capturedAt.desc()),
  ],
);

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { knowledgeSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { concepts } from "./concepts.js";

export const conceptMastery = knowledgeSchema.table(
  "concept_mastery",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "restrict" }),
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

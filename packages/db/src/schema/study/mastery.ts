import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { resources, resourceVersions } from "../catalog/resources.js";
import { users } from "../identity/users.js";
import { studySessions } from "./sessions.js";

/**
 * The hard questions a learner must pass (65%) after watching a video before it counts as complete. Questions keep their
 * answer keys here and reach the browser without them; a failed set is kept, and the next set avoids its questions.
 */
export const masteryChecks = studySchema.table(
  "mastery_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "restrict" }),
    resourceVersionId: uuid("resource_version_id").references(() => resourceVersions.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("open"),
    questions: jsonb("questions").$type<unknown[]>().notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    score: numeric("score", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Null while questions are still being written into the set: the learner answers the first ones meanwhile, and the set is
    // scored only once it is whole.
    writtenAt: timestamp("written_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // The learning analysis written once the set is scored: { status: "writing", startedAt } | { status: "failed" } |
    // { status: "ready", ...analysis }. Null until it is asked for.
    analysis: jsonb("analysis").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("mastery_checks_user_resource_idx").on(table.userId, table.resourceId, table.createdAt.desc()),
    // One set at a time per video, so two tabs cannot each start one.
    uniqueIndex("mastery_checks_open_uq").on(table.userId, table.resourceId).where(sql`${table.status} = 'open'`),
    index("mastery_checks_folder_idx").on(table.studySessionId, table.createdAt.desc()).where(sql`${table.resourceId} IS NULL`),
    uniqueIndex("mastery_checks_open_folder_uq").on(table.studySessionId).where(sql`${table.status} = 'open' AND ${table.resourceId} IS NULL`),
    check("mastery_checks_resource_version_pair_chk", sql`(${table.resourceId} IS NULL) = (${table.resourceVersionId} IS NULL)`),
    check("mastery_checks_status_chk", sql`${table.status} IN ('open', 'passed', 'failed')`),
    foreignKey({
      name: "mastery_checks_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
  ],
);

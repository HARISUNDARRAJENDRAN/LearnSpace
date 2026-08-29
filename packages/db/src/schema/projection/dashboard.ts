import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projectionSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { studySessions } from "../study/sessions.js";

export const dashboardState = projectionSchema.table("dashboard_state", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  activeSessionId: uuid("active_session_id").references(() => studySessions.id, { onDelete: "set null" }),
  continueLearning: jsonb("continue_learning").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  nextActions: jsonb("next_actions").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  activeResearch: jsonb("active_research").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  masterySummary: jsonb("mastery_summary").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  focusSummary: jsonb("focus_summary").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  projectionVersion: text("projection_version").notNull(),
  sourceEventAt: timestamp("source_event_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userLearningDaily = projectionSchema.table(
  "user_learning_daily",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    focusedSeconds: integer("focused_seconds").notNull().default(0),
    resourcesOpened: integer("resources_opened").notNull().default(0),
    resourcesCompleted: integer("resources_completed").notNull().default(0),
    questionsAsked: integer("questions_asked").notNull().default(0),
    exercisesAttempted: integer("exercises_attempted").notNull().default(0),
    exercisesCompleted: integer("exercises_completed").notNull().default(0),
    conceptsEncountered: integer("concepts_encountered").notNull().default(0),
    reviewsCompleted: integer("reviews_completed").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

export const sessionSummary = projectionSchema.table(
  "session_summary",
  {
    studySessionId: uuid("study_session_id").primaryKey().references(() => studySessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceCount: integer("resource_count").notNull(),
    questionCount: integer("question_count").notNull(),
    exerciseCount: integer("exercise_count").notNull(),
    artifactCount: integer("artifact_count").notNull(),
    focusSeconds: integer("focus_seconds").notNull(),
    conceptIds: uuid("concept_ids").array().notNull().default(sql`'{}'::uuid[]`),
    openQuestionCount: integer("open_question_count").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    projectionVersion: text("projection_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("session_summary_user_activity_idx").on(table.userId, table.lastActivityAt.desc())],
);

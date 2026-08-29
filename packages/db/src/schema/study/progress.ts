import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { concepts } from "../knowledge/concepts.js";
import { resourceChunks } from "../retrieval/chunks.js";
import { resources } from "../catalog/resources.js";
import { learningGoals } from "./goals.js";
import { studySessions } from "./sessions.js";

export const userResourceProgress = studySchema.table(
  "user_resource_progress",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    lastSessionId: uuid("last_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    status: text("status").notNull().default("not_started"),
    progressPct: real("progress_pct"),
    lastAnchor: jsonb("last_anchor").$type<Record<string, unknown>>(),
    lastChunkId: uuid("last_chunk_id").references(() => resourceChunks.id, { onDelete: "set null" }),
    firstStartedAt: timestamp("first_started_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.resourceId] }),
    check("user_resource_progress_pct_chk", sql`${table.progressPct} IS NULL OR ${table.progressPct} BETWEEN 0 AND 100`),
    index("user_resource_progress_user_status_updated_idx").on(table.userId, table.status, table.updatedAt.desc()),
  ],
);

export const focusSessions = studySchema.table(
  "focus_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    mode: text("mode").notNull(),
    plannedDurationSec: integer("planned_duration_sec"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    completed: boolean("completed").notNull().default(false),
    interruptionCount: integer("interruption_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("focus_sessions_end_after_start_chk", sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`),
    check("focus_sessions_duration_chk", sql`${table.durationSec} IS NULL OR ${table.durationSec} >= 0`),
    index("focus_sessions_user_started_idx").on(table.userId, table.startedAt.desc()),
    index("focus_sessions_session_started_idx").on(table.studySessionId, table.startedAt.desc()),
  ],
);

export const scheduleItems = studySchema.table(
  "schedule_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    learningGoalId: uuid("learning_goal_id").references(() => learningGoals.id, { onDelete: "set null" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("planned"),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("schedule_items_end_after_start_chk", sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`),
    index("schedule_items_user_starts_idx").on(table.userId, table.startsAt),
    index("schedule_items_user_status_starts_idx").on(table.userId, table.status, table.startsAt),
  ],
);

import { sql } from "drizzle-orm";
import { char, check, foreignKey, index, integer, jsonb, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { sessionMode, sessionStatus } from "../domain-values.js";
import { users } from "../identity/users.js";
import { resourceChunks } from "../retrieval/chunks.js";
import { learningGoals } from "./goals.js";
import { resources, resourceVersions } from "../catalog/resources.js";

export const studySessions = studySchema.table(
  "study_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    learningGoalId: uuid("learning_goal_id").references(() => learningGoals.id, { onDelete: "set null" }),
    title: text("title"),
    mode: sessionMode("mode").notNull(),
    status: sessionStatus("status").notNull().default("active"),
    activeResourceId: uuid("active_resource_id"),
    activeVersionId: uuid("active_version_id"),
    activeChunkId: uuid("active_chunk_id"),
    activeAnchor: jsonb("active_anchor").$type<Record<string, unknown>>(),
    contextVersion: integer("context_version").notNull().default(0),
    lockVersion: integer("lock_version").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("study_sessions_user_status_active_idx").on(table.userId, table.status, table.lastActiveAt.desc()),
    index("study_sessions_goal_active_idx").on(table.learningGoalId, table.lastActiveAt.desc()),
    index("study_sessions_user_active_partial_idx").on(table.userId, table.lastActiveAt.desc()).where(sql`${table.status} = 'active'`),
    check("study_sessions_end_after_start_chk", sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`),
    check("study_sessions_context_version_chk", sql`${table.contextVersion} >= 0`),
    check("study_sessions_lock_version_chk", sql`${table.lockVersion} >= 0`),
    check("study_sessions_active_pin_pair_chk", sql`(${table.activeResourceId} IS NULL) = (${table.activeVersionId} IS NULL)`),
    check("study_sessions_active_chunk_pair_chk", sql`${table.activeChunkId} IS NULL OR ${table.activeVersionId} IS NOT NULL`),
    unique("study_sessions_user_id_uq").on(table.userId, table.id),
    foreignKey({
      name: "study_sessions_goal_user_fkey",
      columns: [table.userId, table.learningGoalId],
      foreignColumns: [learningGoals.userId, learningGoals.id],
    }),
    foreignKey({
      name: "study_sessions_active_resource_version_fkey",
      columns: [table.activeResourceId, table.activeVersionId],
      foreignColumns: [resourceVersions.resourceId, resourceVersions.id],
    }).onDelete("set null"),
    foreignKey({
      name: "study_sessions_active_version_chunk_fkey",
      columns: [table.activeVersionId, table.activeChunkId],
      foreignColumns: [resourceChunks.resourceVersionId, resourceChunks.id],
    }).onDelete("set null"),
  ],
);

export const sessionResources = studySchema.table(
  "session_resources",
  {
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    resourceVersionId: uuid("resource_version_id").notNull().references(() => resourceVersions.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    position: integer("position").notNull().default(0),
    addedBy: text("added_by").notNull(),
    lastAnchor: jsonb("last_anchor").$type<Record<string, unknown>>(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.studySessionId, table.resourceId] }),
    uniqueIndex("session_resources_session_position_uq").on(table.studySessionId, table.position),
    foreignKey({
      name: "session_resources_resource_version_fkey",
      columns: [table.resourceId, table.resourceVersionId],
      foreignColumns: [resourceVersions.resourceId, resourceVersions.id],
    }).onDelete("restrict"),
  ],
);

export const sessionContextSnapshots = studySchema.table(
  "session_context_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sourceEventId: uuid("source_event_id"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull(),
    contentSha256: char("content_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("session_context_snapshots_session_version_uq").on(table.studySessionId, table.version)],
);

export const sessionCheckpoints = studySchema.table(
  "session_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    resourceId: uuid("resource_id"),
    resourceVersionId: uuid("resource_version_id"),
    resourceChunkId: uuid("resource_chunk_id"),
    anchor: jsonb("anchor").$type<Record<string, unknown>>(),
    label: text("label"),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("session_checkpoints_session_created_idx").on(table.studySessionId, table.createdAt.desc()),
    check("session_checkpoints_resource_version_pair_chk", sql`(${table.resourceId} IS NULL) = (${table.resourceVersionId} IS NULL)`),
    check("session_checkpoints_chunk_version_pair_chk", sql`${table.resourceChunkId} IS NULL OR ${table.resourceVersionId} IS NOT NULL`),
    foreignKey({
      name: "session_checkpoints_resource_version_fkey",
      columns: [table.resourceId, table.resourceVersionId],
      foreignColumns: [resourceVersions.resourceId, resourceVersions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "session_checkpoints_version_chunk_fkey",
      columns: [table.resourceVersionId, table.resourceChunkId],
      foreignColumns: [resourceChunks.resourceVersionId, resourceChunks.id],
    }).onDelete("restrict"),
  ],
);

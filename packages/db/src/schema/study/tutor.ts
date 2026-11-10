import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { resources } from "../catalog/resources.js";
import { users } from "../identity/users.js";
import { studySessions } from "./sessions.js";

export const tutorThreads = studySchema.table(
  "tutor_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "restrict" }),
    // The one video this thread is grounded in; a lesson switch opens another thread instead of widening this one.
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tutor_threads_session_updated_idx").on(table.studySessionId, table.updatedAt.desc()),
    uniqueIndex("tutor_threads_active_resource_uq").on(table.studySessionId, table.resourceId).where(sql`${table.status} = 'active'`),
    unique("tutor_threads_user_id_uq").on(table.userId, table.id),
    unique("tutor_threads_id_session_uq").on(table.id, table.studySessionId),
    foreignKey({
      name: "tutor_threads_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
  ],
);

export const tutorMessages = studySchema.table(
  "tutor_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").notNull().references(() => tutorThreads.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    status: text("status").notNull().default("completed"),
    idempotencyKey: text("idempotency_key"),
    agentRunId: uuid("agent_run_id"),
    contentText: text("content_text"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    audioObjectKey: text("audio_object_key"),
    sourceMessageId: uuid("source_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tutor_messages_thread_created_idx").on(table.threadId, table.createdAt),
    unique("tutor_messages_thread_id_uq").on(table.threadId, table.id),
    uniqueIndex("tutor_messages_thread_idempotency_uq").on(table.threadId, table.idempotencyKey),
    check("tutor_messages_status_chk", sql`${table.status} IN ('pending', 'completed', 'failed', 'cancelled')`),
    foreignKey({
      name: "tutor_messages_source_message_fkey",
      columns: [table.threadId, table.sourceMessageId],
      foreignColumns: [table.threadId, table.id],
    }).onDelete("restrict"),
  ],
);

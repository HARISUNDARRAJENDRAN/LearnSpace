import { sql } from "drizzle-orm";
import { foreignKey, index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { studySessions } from "./sessions.js";

export const tutorThreads = studySchema.table(
  "tutor_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").notNull().references(() => studySessions.id, { onDelete: "cascade" }),
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
    foreignKey({
      name: "tutor_threads_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("cascade"),
  ],
);

export const tutorMessages = studySchema.table(
  "tutor_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").notNull().references(() => tutorThreads.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    agentRunId: uuid("agent_run_id"),
    contentText: text("content_text"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    audioObjectKey: text("audio_object_key"),
    sourceMessageId: uuid("source_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tutor_messages_thread_created_idx").on(table.threadId, table.createdAt)],
);

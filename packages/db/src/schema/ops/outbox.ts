import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";
import { outboxStatus } from "../domain-values.js";
import { users } from "../identity/users.js";
import { studySessions } from "../study/sessions.js";

export const outboxEvents = opsSchema.table(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateVersion: integer("aggregate_version"),
    eventType: text("event_type").notNull(),
    schemaVersion: smallint("schema_version").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "restrict" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
    traceId: text("trace_id"),
    correlationId: uuid("correlation_id"),
    causationId: uuid("causation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbox_events_publish_idx").on(table.availableAt, table.createdAt).where(sql`${table.status} = 'pending'`),
    index("outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId, table.createdAt),
    index("outbox_events_correlation_idx").on(table.correlationId),
    check("outbox_events_session_user_pair_chk", sql`${table.studySessionId} IS NULL OR ${table.userId} IS NOT NULL`),
    foreignKey({
      name: "outbox_events_user_session_fkey",
      columns: [table.userId, table.studySessionId],
      foreignColumns: [studySessions.userId, studySessions.id],
    }).onDelete("restrict"),
  ],
);

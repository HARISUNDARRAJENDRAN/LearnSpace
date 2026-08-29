import { sql } from "drizzle-orm";
import { check, index, jsonb, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { activitySchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { concepts } from "../knowledge/concepts.js";
import { resourceChunks } from "../retrieval/chunks.js";
import { resources, resourceVersions } from "../catalog/resources.js";
import { studySessions } from "../study/sessions.js";

export const activityEvents = activitySchema.table(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schemaVersion: smallint("schema_version").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    studySessionId: uuid("study_session_id").references(() => studySessions.id, { onDelete: "set null" }),
    resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
    resourceVersionId: uuid("resource_version_id").references(() => resourceVersions.id, { onDelete: "set null" }),
    resourceChunkId: uuid("resource_chunk_id").references(() => resourceChunks.id, { onDelete: "set null" }),
    conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    source: text("source").notNull(),
    clientEventId: text("client_event_id"),
    idempotencyKey: text("idempotency_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    traceId: text("trace_id"),
    correlationId: uuid("correlation_id"),
    causationId: uuid("causation_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    check("activity_events_schema_version_chk", sql`${table.schemaVersion} > 0`),
    index("activity_events_user_time_idx").on(table.userId, table.occurredAt.desc()),
    index("activity_events_session_time_idx").on(table.studySessionId, table.occurredAt),
    index("activity_events_resource_type_time_idx").on(table.resourceId, table.eventType, table.occurredAt.desc()),
    index("activity_events_concept_type_time_idx").on(table.conceptId, table.eventType, table.occurredAt.desc()),
    uniqueIndex("activity_events_user_idempotency_uq").on(table.userId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("activity_events_source_client_event_uq").on(table.source, table.clientEventId).where(sql`${table.clientEventId} IS NOT NULL`),
  ],
);

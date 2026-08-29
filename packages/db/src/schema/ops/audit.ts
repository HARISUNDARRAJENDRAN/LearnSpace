import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";
import { users } from "../identity/users.js";

export const deadLetterEvents = opsSchema.table(
  "dead_letter_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    failureCode: text("failure_code").notNull(),
    failureDetail: text("failure_detail").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }).notNull(),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    index("dead_letter_events_resolution_idx").on(table.resolvedAt, table.lastFailedAt.desc()),
    check("dead_letter_events_attempt_count_chk", sql`${table.attemptCount} > 0`),
  ],
);

export const idempotencyRecords = opsSchema.table(
  "idempotency_records",
  {
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    requestSha256: char("request_sha256", { length: 64 }).notNull(),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown> | null>(),
    resourceId: uuid("resource_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.idempotencyKey] }),
    index("idempotency_records_expires_idx").on(table.expiresAt),
  ],
);

export const auditLog = opsSchema.table(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    userId: uuid("user_id"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    traceId: text("trace_id"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity_created_idx").on(table.entityType, table.entityId, table.createdAt.desc()),
    index("audit_log_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

export const backfillCheckpoints = opsSchema.table(
  "backfill_checkpoints",
  {
    backfillName: text("backfill_name").notNull(),
    partitionKey: text("partition_key").notNull(),
    cursorValue: text("cursor_value"),
    rowsProcessed: bigint("rows_processed", { mode: "number" }).notNull().default(0),
    status: text("status").notNull(),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.backfillName, table.partitionKey] })],
);

import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";
import { jobStatus } from "../domain-values.js";

export const jobs = opsSchema.table(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    queue: text("queue").notNull(),
    jobType: text("job_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    dedupKey: text("dedup_key"),
    idempotencyKey: text("idempotency_key"),
    correlationId: uuid("correlation_id"),
    traceId: text("trace_id"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorDetail: text("last_error_detail"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_claim_idx").on(table.queue, table.priority.desc(), table.availableAt, table.createdAt).where(sql`${table.status} = 'pending'`),
    uniqueIndex("jobs_active_dedup_uq").on(table.queue, table.dedupKey).where(sql`${table.dedupKey} IS NOT NULL AND ${table.status} IN ('pending', 'running')`),
    index("jobs_running_lease_idx").on(table.status, table.leaseExpiresAt).where(sql`${table.status} = 'running'`),
    index("jobs_correlation_idx").on(table.correlationId),
    check("jobs_attempts_chk", sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attempts} <= ${table.maxAttempts}`),
  ],
);

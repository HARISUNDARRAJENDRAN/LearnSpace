import { sql } from "drizzle-orm";
import { foreignKey, index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { retrievalSchema } from "../namespaces.js";
import { resources, resourceVersions } from "../catalog/resources.js";

export const ingestionRuns = retrievalSchema.table(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    resourceVersionId: uuid("resource_version_id").notNull().references(() => resourceVersions.id, { onDelete: "cascade" }),
    pipelineVersion: text("pipeline_version").notNull(),
    status: text("status").notNull(),
    requestedBy: text("requested_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    traceId: text("trace_id"),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ingestion_runs_version_pipeline_uq").on(table.resourceVersionId, table.pipelineVersion),
    index("ingestion_runs_status_created_idx").on(table.status, table.createdAt),
    foreignKey({
      name: "ingestion_runs_resource_version_fkey",
      columns: [table.resourceId, table.resourceVersionId],
      foreignColumns: [resourceVersions.resourceId, resourceVersions.id],
    }).onDelete("cascade"),
  ],
);

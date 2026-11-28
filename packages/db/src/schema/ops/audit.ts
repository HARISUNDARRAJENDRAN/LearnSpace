import { char, index, integer, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";
import { users } from "../identity/users.js";

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

import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";

/** Fixed-window request counters; one row per bucket, client and identifier. */
export const rateLimitCounters = opsSchema.table("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

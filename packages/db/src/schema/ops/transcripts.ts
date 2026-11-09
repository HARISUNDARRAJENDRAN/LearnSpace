import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { opsSchema } from "../namespaces.js";
import { resources } from "../catalog/resources.js";

/** One row per video that needs a transcript: the home signer turns `queued` into a signed caption URL for learners' browsers. */
export const transcriptRequests = opsSchema.table("transcript_requests", {
  resourceId: uuid("resource_id").primaryKey().references(() => resources.id, { onDelete: "cascade" }),
  youtubeId: text("youtube_id").notNull(),
  status: text("status").notNull().default("queued"),
  captionUrl: text("caption_url"),
  language: text("language"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  detail: text("detail"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("transcript_requests_status_requested_idx").on(table.status, table.requestedAt),
  check("transcript_requests_status_chk", sql`${table.status} IN ('queued', 'signed', 'ready', 'unavailable', 'failed')`),
]);

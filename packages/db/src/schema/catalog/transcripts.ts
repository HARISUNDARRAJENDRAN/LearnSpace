import { char, jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { resources } from "./resources.js";

/** A learner's browser download of a video's captions. The first one is published for everyone; its row then stays, emptied, as the record of who supplied it. */
export const transcriptSubmissions = catalogSchema.table("transcript_submissions", {
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  contentSha256: char("content_sha256", { length: 64 }).notNull(),
  segments: jsonb("segments").$type<[number, number, string][]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.resourceId, table.userId] })]);

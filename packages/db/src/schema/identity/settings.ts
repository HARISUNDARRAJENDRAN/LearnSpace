import { sql } from "drizzle-orm";
import { jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { identitySchema } from "../namespaces.js";
import { users } from "./users.js";

export const userSettings = identitySchema.table("user_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  learningPreferences: jsonb("learning_preferences").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  notificationSettings: jsonb("notification_settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  privacySettings: jsonb("privacy_settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  accessibility: jsonb("accessibility").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

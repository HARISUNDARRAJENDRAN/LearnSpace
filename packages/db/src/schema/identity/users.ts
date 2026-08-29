import { sql } from "drizzle-orm";
import { boolean, check, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { identitySchema } from "../namespaces.js";
import { subscriptionTier, userStatus } from "../domain-values.js";

export const users = identitySchema.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    passwordHash: text("password_hash"),
    status: userStatus("status").notNull().default("active"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull().default("UTC"),
    subscriptionTier: subscriptionTier("subscription_tier").notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_email_normalized_uq").on(sql`lower(${table.email})`),
    index("users_status_created_idx").on(table.status, table.createdAt),
    check(
      "users_deleted_state_chk",
      sql`${table.deletedAt} IS NULL OR ${table.status} IN ('deletion_pending', 'deleted')`,
    ),
  ],
);

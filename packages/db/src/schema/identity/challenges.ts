import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { identitySchema } from "../namespaces.js";
import { users } from "./users.js";

export const authChallenges = identitySchema.table(
  "auth_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("auth_challenges_token_hash_uq").on(table.tokenHash),
    index("auth_challenges_user_purpose_idx").on(table.userId, table.purpose, table.createdAt.desc()),
    check(
      "auth_challenges_purpose_chk",
      sql`${table.purpose} IN ('email_verification', 'password_reset')`,
    ),
  ],
);

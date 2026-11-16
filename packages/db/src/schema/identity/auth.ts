import { sql } from "drizzle-orm";
import { boolean, index, jsonb, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { identitySchema } from "../namespaces.js";
import { users } from "./users.js";

export const authAccounts = identitySchema.table(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerEmail: text("provider_email"),
    emailVerified: boolean("email_verified").notNull().default(false),
    profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_uq").on(table.provider, table.providerAccountId),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);

export const authSessions = identitySchema.table(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rotationFamilyId: uuid("rotation_family_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    rotatedFromId: uuid("rotated_from_id"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_sessions_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("auth_sessions_rotation_family_idx").on(table.rotationFamilyId),
    index("auth_sessions_active_expiry_idx")
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
    unique("auth_sessions_user_id_uq").on(table.userId, table.id),
    // Every request finds its session by the cookie's hash; without this the lookup reads the whole table.
    index("auth_sessions_refresh_token_hash_idx").on(table.refreshTokenHash),
  ],
);

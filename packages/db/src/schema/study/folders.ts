import { sql } from "drizzle-orm";
import { char, check, foreignKey, index, integer, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { resources } from "../catalog/resources.js";
import { users } from "../identity/users.js";
import { studySchema } from "../namespaces.js";
import { studySessions } from "./sessions.js";

export const sessionFolders = studySchema.table("session_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("session_folders_user_id_uq").on(table.userId, table.id),
  index("session_folders_order_idx").on(table.userId, table.position, table.id),
]);

export const sessionFolderMemberships = studySchema.table("session_folder_memberships", {
  folderId: uuid("folder_id").notNull(),
  userId: uuid("user_id").notNull(),
  studySessionId: uuid("study_session_id").primaryKey(),
  position: integer("position").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "session_folder_memberships_folder_fk", columns: [table.userId, table.folderId], foreignColumns: [sessionFolders.userId, sessionFolders.id] }).onDelete("cascade"),
  foreignKey({ name: "session_folder_memberships_session_fk", columns: [table.userId, table.studySessionId], foreignColumns: [studySessions.userId, studySessions.id] }).onDelete("cascade"),
  index("session_folder_memberships_order_idx").on(table.userId, table.folderId, table.position, table.studySessionId),
]);

export const sessionFolderResources = studySchema.table("session_folder_resources", {
  folderId: uuid("folder_id").notNull(),
  userId: uuid("user_id").notNull(),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.folderId, table.resourceId] }),
  foreignKey({ name: "session_folder_resources_folder_fk", columns: [table.userId, table.folderId], foreignColumns: [sessionFolders.userId, sessionFolders.id] }).onDelete("cascade"),
  index("session_folder_resources_order_idx").on(table.userId, table.folderId, table.position, table.resourceId),
  index("session_folder_resources_resource_idx").on(table.resourceId),
]);

export const sessionFolderShares = studySchema.table("session_folder_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  folderId: uuid("folder_id").notNull(),
  userId: uuid("user_id").notNull(),
  tokenHash: char("token_hash", { length: 64 }).notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "session_folder_shares_folder_fk", columns: [table.userId, table.folderId], foreignColumns: [sessionFolders.userId, sessionFolders.id] }).onDelete("cascade"),
  unique("session_folder_shares_token_hash_uq").on(table.tokenHash),
  uniqueIndex("session_folder_shares_active_uq").on(table.folderId).where(sql`${table.revokedAt} IS NULL`),
  index("session_folder_shares_user_folder_idx").on(table.userId, table.folderId),
  check("session_folder_shares_hash_chk", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
]);

export const sessionFolderShareImports = studySchema.table("session_folder_share_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  shareId: uuid("share_id").notNull(),
  userId: uuid("user_id").notNull(),
  clonedFolderId: uuid("cloned_folder_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("session_folder_imports_share_user_uq").on(table.shareId, table.userId),
  foreignKey({ name: "session_folder_imports_share_fk", columns: [table.shareId], foreignColumns: [sessionFolderShares.id] }).onDelete("cascade"),
  foreignKey({ name: "session_folder_imports_user_fk", columns: [table.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  foreignKey({ name: "session_folder_imports_folder_fk", columns: [table.userId, table.clonedFolderId], foreignColumns: [sessionFolders.userId, sessionFolders.id] }).onDelete("cascade"),
  index("session_folder_imports_user_idx").on(table.userId, table.createdAt.desc()),
]);

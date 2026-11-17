import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { resourceVisibility } from "../domain-values.js";
import { users } from "../identity/users.js";
import { resources } from "./resources.js";

export const collections = catalogSchema.table(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    slug: text("slug"),
    visibility: resourceVisibility("visibility").notNull().default("private"),
    title: text("title").notNull(),
    description: text("description"),
    coverObjectKey: text("cover_object_key"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("collections_slug_uq").on(table.slug).where(sql`${table.slug} IS NOT NULL`),
    index("collections_owner_updated_idx").on(table.ownerUserId, table.updatedAt.desc()),
    index("collections_kind_visibility_published_idx").on(table.kind, table.visibility, table.publishedAt.desc()),
  ],
);

export const collectionSections = catalogSchema.table(
  "collection_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("collection_sections_collection_position_uq").on(table.collectionId, table.position)],
);

export const collectionItems = catalogSchema.table(
  "collection_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sectionId: uuid("section_id").notNull().references(() => collectionSections.id, { onDelete: "restrict" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    required: boolean("required").notNull().default(true),
    note: text("note"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("collection_items_section_position_uq").on(table.sectionId, table.position),
    uniqueIndex("collection_items_section_resource_uq").on(table.sectionId, table.resourceId),
    index("collection_items_resource_idx").on(table.resourceId),
  ],
);

export const collectionEnrollments = catalogSchema.table(
  "collection_enrollments",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    currentItemId: uuid("current_item_id").references(() => collectionItems.id, { onDelete: "restrict" }),
    progressPct: real("progress_pct").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.collectionId] }),
    check("collection_enrollments_progress_pct_chk", sql`${table.progressPct} BETWEEN 0 AND 100`),
    index("collection_enrollments_user_updated_idx").on(table.userId, table.updatedAt.desc()),
  ],
);

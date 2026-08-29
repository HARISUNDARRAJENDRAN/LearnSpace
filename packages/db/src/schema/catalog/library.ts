import { index, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { users } from "../identity/users.js";
import { resources } from "./resources.js";

export const libraryItems = catalogSchema.table(
  "library_items",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("saved"),
    source: text("source").notNull().default("user"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.resourceId] }),
    index("library_items_user_updated_idx").on(table.userId, table.updatedAt.desc()),
  ],
);

import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { catalogSchema } from "../namespaces.js";
import { resources } from "./resources.js";

export const paperDetails = catalogSchema.table("paper_details", {
  resourceId: uuid("resource_id").primaryKey().references(() => resources.id, { onDelete: "restrict" }),
  arxivId: text("arxiv_id").unique(),
  doi: text("doi").unique(),
  abstract: text("abstract"),
  venue: text("venue"),
  publicationDate: date("publication_date"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  primaryCategory: text("primary_category"),
  license: text("license"),
  pdfSourceUrl: text("pdf_source_url"),
  citationCount: integer("citation_count"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
});

export const authors = catalogSchema.table(
  "authors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedName: text("normalized_name").notNull(),
    preferredName: text("preferred_name").notNull(),
    orcid: text("orcid").unique(),
    semanticScholarId: text("semantic_scholar_id").unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("authors_normalized_name_idx").on(table.normalizedName)],
);

export const paperAuthors = catalogSchema.table(
  "paper_authors",
  {
    paperResourceId: uuid("paper_resource_id").notNull().references(() => paperDetails.resourceId, { onDelete: "restrict" }),
    authorId: uuid("author_id").notNull().references(() => authors.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    affiliation: text("affiliation"),
  },
  (table) => [
    primaryKey({ columns: [table.paperResourceId, table.authorId] }),
    uniqueIndex("paper_authors_paper_ordinal_uq").on(table.paperResourceId, table.ordinal),
  ],
);

export const paperReferences = catalogSchema.table(
  "paper_references",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paperResourceId: uuid("paper_resource_id").notNull().references(() => paperDetails.resourceId, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    rawReference: text("raw_reference").notNull(),
    citedResourceId: uuid("cited_resource_id").references(() => resources.id, { onDelete: "set null" }),
    citedDoi: text("cited_doi"),
    citedArxivId: text("cited_arxiv_id"),
    resolutionStatus: text("resolution_status").notNull().default("unresolved"),
    confidence: real("confidence"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex("paper_references_paper_ordinal_uq").on(table.paperResourceId, table.ordinal),
    index("paper_references_cited_resource_idx").on(table.citedResourceId),
    index("paper_references_cited_doi_idx").on(table.citedDoi),
  ],
);

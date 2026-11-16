import { z } from "zod";
import { studyResourceReadinessSchema } from "./contracts.js";

export const researchAuthorSummarySchema = z.object({
  authorId: z.string().uuid(),
  name: z.string(),
  paperCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  followed: z.boolean(),
  affinityScore: z.number().nonnegative(),
  source: z.enum(["followed", "engaged", "suggested"]),
});
export type ResearchAuthorSummary = z.infer<typeof researchAuthorSummarySchema>;

export const researchPaperSchema = z.object({
  resourceId: z.string().uuid(),
  title: z.string(),
  abstract: z.string().nullable(),
  authors: z.array(z.string()),
  authorIds: z.array(z.string().uuid()),
  venue: z.string().nullable(),
  publicationDate: z.string().nullable(),
  arxivId: z.string().nullable(),
  doi: z.string().nullable(),
  pdfSourceUrl: z.string().nullable(),
  conceptNames: z.array(z.string()),
  saved: z.boolean(),
  readiness: studyResourceReadinessSchema,
});
export type ResearchPaper = z.infer<typeof researchPaperSchema>;

export const researchAuthorFollowRequestSchema = z.object({ follow: z.boolean() }).strict();

import { z } from "zod";
import {
  ACTOR_TYPES,
  EVENT_SOURCES,
  EVENT_TYPES,
  RESOURCE_TYPES,
  RESOURCE_ROLES,
  COLLECTION_KINDS,
  PROGRESS_STATUSES,
  SESSION_MODES,
  SUBSCRIPTION_TIERS,
} from "./domain-values.js";

export const subscriptionTierSchema = z.enum(SUBSCRIPTION_TIERS);
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export const sessionModeSchema = z.enum(SESSION_MODES);
export const activityEventTypeSchema = z.enum(EVENT_TYPES);
export const activityActorTypeSchema = z.enum(ACTOR_TYPES);
export const activitySourceSchema = z.enum(EVENT_SOURCES);
export const resourceRoleSchema = z.enum(RESOURCE_ROLES);
export const collectionKindSchema = z.enum(COLLECTION_KINDS);
export const progressStatusSchema = z.enum(PROGRESS_STATUSES);

export const studyOriginSchema = z.enum(["home", "discover", "research", "library", "collection", "session", "related"]);
export const studyResourceReadinessSchema = z.enum(["preparing", "ready", "unavailable"]);
export const studyAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("video"), positionMs: z.number().int().min(0).max(86_400_000) }).strict(),
  z.object({
    kind: z.literal("paper"),
    page: z.number().int().positive().optional(),
    sectionId: z.string().min(1).max(200).optional(),
  }).strict().refine((value) => value.page !== undefined || value.sectionId !== undefined, "A paper anchor needs a page or section."),
]);

export const startStudySessionRequestSchema = z.object({
  resourceId: z.string().uuid(),
  origin: studyOriginSchema,
  recommendationRunId: z.string().uuid().optional(),
  collectionId: z.string().uuid().optional(),
  collectionItemId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
  correlationId: z.string().uuid().optional(),
  mode: sessionModeSchema.optional(),
}).strict();

export const activateSessionResourceRequestSchema = z.object({
  resourceId: z.string().uuid(),
  role: resourceRoleSchema.optional(),
  anchor: studyAnchorSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export const studyProgressRequestSchema = z.object({
  resourceId: z.string().uuid(),
  progressPct: z.number().finite().min(0).max(100),
  anchor: studyAnchorSchema,
  event: z.enum(["checkpoint", "play", "pause", "seek", "complete"]),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export const studySessionActionRequestSchema = z.object({
  action: z.enum(["pause", "complete"]),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export const studyQuestionRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
  anchor: studyAnchorSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export const libraryItemRequestSchema = z.object({
  resourceId: z.string().uuid(),
  action: z.enum(["save", "remove"]),
}).strict();

export const startCollectionRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export type StudyOrigin = z.infer<typeof studyOriginSchema>;
export type StudyResourceReadiness = z.infer<typeof studyResourceReadinessSchema>;
export type StudyAnchor = z.infer<typeof studyAnchorSchema>;
export type StartStudySessionRequest = z.infer<typeof startStudySessionRequestSchema>;
export type ActivateSessionResourceRequest = z.infer<typeof activateSessionResourceRequestSchema>;
export type StudyProgressRequest = z.infer<typeof studyProgressRequestSchema>;
export type StudySessionActionRequest = z.infer<typeof studySessionActionRequestSchema>;
export type StudyQuestionRequest = z.infer<typeof studyQuestionRequestSchema>;
export type LibraryItemRequest = z.infer<typeof libraryItemRequestSchema>;
export type StartCollectionRequest = z.infer<typeof startCollectionRequestSchema>;

export type StudyResourceProgress = {
  status: z.infer<typeof progressStatusSchema>;
  progressPct: number;
  lastAnchor: StudyAnchor | null;
  firstStartedAt: string | null;
  lastOpenedAt: string | null;
  completedAt: string | null;
};

export type StudySessionResource = {
  resourceId: string;
  type: "video" | "paper";
  title: string;
  description: string | null;
  role: z.infer<typeof resourceRoleSchema>;
  position: number;
  resourceVersionId: string | null;
  readiness: StudyResourceReadiness;
  lastAnchor: StudyAnchor | null;
  progress: StudyResourceProgress;
  canonicalUrl: string | null;
  video: { youtubeId: string; durationMs: number | null; channelTitle: string | null } | null;
  paper: {
    arxivId: string | null;
    doi: string | null;
    abstract: string | null;
    venue: string | null;
    publicationDate: string | null;
    pdfSourceUrl: string | null;
    authors: string[];
  } | null;
  concepts: Array<{ id: string; name: string; relevance: number; isPrimary: boolean }>;
  chunks: Array<{
    id: string;
    chunkType: string;
    content: string;
    startMs: number | null;
    endMs: number | null;
    pageFrom: number | null;
    pageTo: number | null;
    headingPath: string[];
  }>;
};

export type StudySessionView = {
  id: string;
  title: string;
  mode: z.infer<typeof sessionModeSchema>;
  status: "active" | "paused" | "completed" | "abandoned";
  startedAt: string;
  lastActiveAt: string;
  activeResourceId: string | null;
  activeAnchor: StudyAnchor | null;
  resources: StudySessionResource[];
  activeResource: StudySessionResource | null;
  checkpoints: Array<{ id: string; resourceId: string | null; kind: string; label: string | null; anchor: StudyAnchor | null; createdAt: string }>;
  related: StudySessionResource[];
};

export type StartStudySessionResponse = {
  sessionId: string;
  route: string;
  resourceType: "video" | "paper";
  readiness: StudyResourceReadiness;
  resumed: boolean;
};

export type StudyProgressResponse = {
  sessionId: string;
  resourceId: string;
  progressPct: number;
  status: z.infer<typeof progressStatusSchema>;
};

export type LibraryCollectionSummary = {
  id: string;
  title: string;
  description: string | null;
  kind: z.infer<typeof collectionKindSchema>;
  visibility: "private" | "unlisted" | "public";
  itemCount: number;
  progressPct: number | null;
  currentItemId: string | null;
};

export type LibraryCollectionDetail = LibraryCollectionSummary & {
  sections: Array<{
    id: string;
    title: string;
    description: string | null;
    items: Array<{
      id: string;
      resourceId: string;
      title: string;
      type: "video" | "paper" | "pdf" | "other";
      position: number;
      required: boolean;
      note: string | null;
      progressPct: number;
    }>;
  }>;
};

export type ResearchPaperSummary = {
  resourceId: string;
  title: string;
  abstract: string | null;
  authors: string[];
  venue: string | null;
  publicationDate: string | null;
  arxivId: string | null;
  doi: string | null;
  pdfSourceUrl: string | null;
  conceptNames: string[];
  saved: boolean;
  readiness: StudyResourceReadiness;
};

export const activityEventContract = z.object({
  schemaVersion: z.number().int().positive(),
  userId: z.string().uuid(),
  studySessionId: z.string().uuid().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  resourceVersionId: z.string().uuid().nullable().optional(),
  conceptId: z.string().uuid().nullable().optional(),
  eventType: activityEventTypeSchema,
  actorType: activityActorTypeSchema,
  source: activitySourceSchema,
  occurredAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const idempotencyRequestContract = z.object({
  scope: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ActivityEventContract = z.infer<typeof activityEventContract>;
export type IdempotencyRequestContract = z.infer<typeof idempotencyRequestContract>;

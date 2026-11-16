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
export const collectionOwnershipSchema = z.enum(["user", "learnspace", "other"]);
export const collectionSourceSchema = z.enum(["user", "learnspace", "generated", "public"]);
export const progressStatusSchema = z.enum(PROGRESS_STATUSES);

export const studyOriginSchema = z.enum(["home", "discover", "research", "library", "collection", "session", "related"]);
export const studySessionIdSchema = z.string().uuid();
export const collectionIdSchema = z.string().uuid();
export const studyResourceReadinessSchema = z.enum(["preparing", "ready", "unavailable"]);
export const studyResourceProvenanceReasonSchema = z.enum(["related_explanation", "deeper_dive"]);
export const studyAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("video"), positionMs: z.number().int().min(0).max(86_400_000) }).strict(),
  z.object({
    kind: z.literal("paper"),
    page: z.number().int().positive().optional(),
    sectionId: z.string().min(1).max(200).optional(),
    chunkId: z.string().uuid().optional(),
  }).strict().refine((value) => value.page !== undefined || value.sectionId !== undefined, "A paper anchor needs a page or section."),
]);
export const paperCitationAnchorSchema = z.object({
  kind: z.literal("paper"),
  page: z.number().int().positive(),
  sectionId: z.string().min(1).max(200),
  chunkId: z.string().uuid(),
}).strict();
export type PaperCitationAnchor = z.infer<typeof paperCitationAnchorSchema>;
export const studyResourceProvenanceSchema = z.object({
  resourceId: z.string().uuid(),
  title: z.string().min(1),
  type: z.enum(["video", "paper"]),
  anchor: studyAnchorSchema.nullable(),
  reasonCode: studyResourceProvenanceReasonSchema,
}).strict().refine((value) => value.anchor === null || value.anchor.kind === value.type, "The provenance anchor must match its resource.");

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

/** The study tools that open beside a lesson. */
/** The tools beside what is studied; "guide" (a project and intuition guide) exists for papers only. */
export const STUDY_TOOLS = ["notes", "check", "code", "ai", "guide"] as const;
export const studyToolSchema = z.enum(STUDY_TOOLS);
export const CODE_LANGUAGES = ["python", "javascript", "typescript", "java", "cpp", "go", "rust", "sql"] as const;
export const MAX_SESSION_CODE_LENGTH = 100_000;

/**
 * Where the learner left a session's workspace, restored when they come back to it. Every key is optional and written on its
 * own, so the code autosave and the canvas autosave never overwrite each other.
 */
export const studyWorkspaceSchema = z.object({
  panel: studyToolSchema.nullable(),
  canvas: z.object({ x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6), zoom: z.number().finite().min(0.1).max(4), focused: z.boolean() }).strict(),
  code: z.object({ language: z.enum(CODE_LANGUAGES), code: z.string().max(MAX_SESSION_CODE_LENGTH) }).strict(),
}).partial().strict();

export const updateStudySessionRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
}).strict();

export const reorderStudySessionsRequestSchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "Each session is listed once."),
}).strict();

export const libraryItemRequestSchema = z.object({
  resourceId: z.string().uuid(),
  action: z.enum(["save", "remove"]),
}).strict();

export const addCourseRequestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,96}$/),
}).strict();

export const startCollectionRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export type StudyOrigin = z.infer<typeof studyOriginSchema>;
export type StudySessionId = z.infer<typeof studySessionIdSchema>;
export type StudyResourceReadiness = z.infer<typeof studyResourceReadinessSchema>;
export type StudyResourceProvenance = z.infer<typeof studyResourceProvenanceSchema>;
export type StudyAnchor = z.infer<typeof studyAnchorSchema>;
export type StartStudySessionRequest = z.infer<typeof startStudySessionRequestSchema>;
export type ActivateSessionResourceRequest = z.infer<typeof activateSessionResourceRequestSchema>;
export type StudyProgressRequest = z.infer<typeof studyProgressRequestSchema>;
export type StudySessionActionRequest = z.infer<typeof studySessionActionRequestSchema>;
export type StudyTool = z.infer<typeof studyToolSchema>;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
export type StudyWorkspace = z.infer<typeof studyWorkspaceSchema>;
export type UpdateStudySessionRequest = z.infer<typeof updateStudySessionRequestSchema>;
export type ReorderStudySessionsRequest = z.infer<typeof reorderStudySessionsRequestSchema>;
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
  introducedFrom: StudyResourceProvenance | null;
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
  /** Set when the session is an imported course: every lesson in order, unlocked one at a time. */
  course: StudySessionCourse | null;
  workspace: StudyWorkspace;
};

/** A session as the sidebar and the Sessions page list it. */
export type StudySessionSummary = {
  id: string;
  title: string;
  status: StudySessionView["status"];
  mode: StudySessionView["mode"];
  lastActiveAt: string;
  /** When a finished session moved to the Library. */
  endedAt: string | null;
  resourceCount: number;
  progressPct: number;
  activeResource: { id: string; title: string; type: "video" | "paper"; youtubeId: string | null; readiness: StudyResourceReadiness } | null;
  route: string | null;
  isCourse: boolean;
  /** Whether the session's code draft has anything in it, so the sidebar lists Code Exercises only where there is code. */
  hasCode: boolean;
};

export type StudyCourseLessonState = "completed" | "current" | "locked";

export type StudySessionCourse = {
  collectionId: string;
  slug: string | null;
  title: string;
  sections: Array<{
    id: string;
    title: string;
    /** `byline` is a video's channel or a paper's authors; `summary` is a paper's abstract. */
    lessons: Array<{ resourceId: string; title: string; type: "video" | "paper"; youtubeId: string | null; byline: string | null; summary: string | null; state: StudyCourseLessonState; progressPct: number }>;
  }>;
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
  /** The video was watched to the end, but it counts as complete only once its mastery check is passed. */
  masteryRequired: boolean;
};

export type LibraryCollectionSummary = {
  id: string;
  title: string;
  description: string | null;
  kind: z.infer<typeof collectionKindSchema>;
  ownership: z.infer<typeof collectionOwnershipSchema>;
  source: z.infer<typeof collectionSourceSchema>;
  visibility: "private" | "unlisted" | "public";
  itemCount: number;
  progressPct: number | null;
  currentItemId: string | null;
  /** The learner's enrollment: waiting in their queue, being studied, or finished; null when they own it but never enrolled. */
  status: "queued" | "active" | "completed" | null;
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
      completed: boolean;
      /** Set for YouTube lessons, so a finished one can be rewatched from the Library without reopening it in Sessions. */
      youtubeId: string | null;
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

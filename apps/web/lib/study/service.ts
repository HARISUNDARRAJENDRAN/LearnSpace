import { createHash, randomUUID } from "node:crypto";
import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  activityEvents,
  focusSessions,
  authors,
  collectionEnrollments,
  collectionItems,
  collectionSections,
  collections,
  concepts,
  discoveryInteractions,
  idempotencyRecords,
  libraryItems,
  paperAuthors,
  paperDetails,
  recommendationCandidates,
  recommendationRuns,
  resourceChunks,
  resourceConcepts,
  resourceVersions,
  resources,
  sessionCheckpoints,
  sessionResources,
  studySessions,
  userResourceProgress,
  videoDetails,
} from "@learnspace/db/schema";
import type {
  ActivateSessionResourceRequest,
  StartStudySessionRequest,
  StartStudySessionResponse,
  StudyAnchor,
  StudyProgressRequest,
  StudyProgressResponse,
  StudyResourceProgress,
  StudyResourceProvenance,
  StudyResourceReadiness,
  StudySessionCourse,
  StudySessionResource,
  StudySessionView,
} from "@learnspace/shared";
import {
  activateSessionResourceRequestSchema,
  collectionIdSchema,
  progressStatusSchema,
  resourceRoleSchema,
  sessionModeSchema,
  startStudySessionRequestSchema,
  studyAnchorSchema,
  studySessionIdSchema,
  studyResourceProvenanceReasonSchema,
  studyResourceProvenanceSchema,
  studyResourceReadinessSchema,
} from "@learnspace/shared";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, ne, notInArray, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import { invalidateHomeFeedCache } from "../discovery/cache";
import { projectStudyBehavior } from "../discovery/service";

type StudyType = "video" | "paper";
type SessionRow = typeof studySessions.$inferSelect;
type ProgressRow = typeof userResourceProgress.$inferSelect;
type BindingRow = typeof sessionResources.$inferSelect;
type IdempotencyResult = { status: string; response_body: Record<string, unknown> | null };
// ponytail: keep the initial material window bounded; add cursor/search reads with transcript ingestion.
const initialStudyChunkLimit = 80;

type ResourceRecord = {
  id: string;
  type: typeof resources.$inferSelect.type;
  title: string;
  description: string | null;
  canonicalUrl: string | null;
  visibility: typeof resources.$inferSelect.visibility;
  status: typeof resources.$inferSelect.status;
  deletedAt: Date | null;
  currentVersionId: string | null;
  qualityScore: number | null;
  versionId: string | null;
  versionStatus: string | null;
  video: { youtubeId: string; durationMs: number | null; channelTitle: string | null } | null;
  paper: {
    arxivId: string | null;
    doi: string | null;
    abstract: string | null;
    venue: string | null;
    publicationDate: string | null;
    pdfSourceUrl: string | null;
  } | null;
};

type JoinedBinding = {
  binding: BindingRow;
  resource: ResourceRecord;
};

type CourseLesson = { itemId: string; sectionId: string; sectionTitle: string; resourceId: string; title: string; youtubeId: string | null; channelTitle: string | null };

/** An imported course keeps its collection on the session, so the canvas and the lesson lock can find it. */
function courseOf(session: SessionRow): { collectionId: string; slug: string | null } | null {
  const course = session.metadata.course;
  if (!course || typeof course !== "object" || Array.isArray(course)) return null;
  const { collectionId, slug } = course as Record<string, unknown>;
  return typeof collectionId === "string" ? { collectionId, slug: typeof slug === "string" ? slug : null } : null;
}

function sessionInProgress(): AuthError {
  return new AuthError("SESSION_IN_PROGRESS", "Finish your current session before starting something new.", 409);
}

/** Sessions holds one session at a time: the latest one still in progress. */
async function currentSessionInTransaction(tx: Transaction, userId: string): Promise<SessionRow | null> {
  const [current] = await tx.select().from(studySessions)
    .where(and(eq(studySessions.userId, userId), inArray(studySessions.status, ["active", "paused"]), isNotNull(studySessions.activeResourceId)))
    .orderBy(desc(studySessions.lastActiveAt))
    .limit(1);
  return current ?? null;
}

/** A course's playable lessons in study order; a video listed in two sections is studied once, and optional units are left out. */
async function loadCourseLessons(tx: Transaction, collectionId: string): Promise<CourseLesson[]> {
  const rows = await tx
    .select({ itemId: collectionItems.id, sectionId: collectionSections.id, sectionTitle: collectionSections.title, resourceId: resources.id, title: resources.title, youtubeId: videoDetails.youtubeId, channelTitle: videoDetails.channelTitle })
    .from(collectionItems)
    .innerJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
    .innerJoin(resources, eq(resources.id, collectionItems.resourceId))
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .where(and(eq(collectionSections.collectionId, collectionId), eq(collectionItems.required, true), eq(resources.type, "video"), eq(resources.status, "ready"), isNull(resources.deletedAt)))
    .orderBy(asc(collectionSections.position), asc(collectionItems.position));
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(row.resourceId) && Boolean(seen.add(row.resourceId)));
}

async function completedResourceIds(tx: Transaction, userId: string, resourceIds: string[]): Promise<Set<string>> {
  if (resourceIds.length === 0) return new Set();
  const rows = await tx.select({ resourceId: userResourceProgress.resourceId }).from(userResourceProgress)
    .where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, resourceIds), eq(userResourceProgress.status, "completed")));
  return new Set(rows.map((row) => row.resourceId));
}

/** Lessons unlock in order: a lesson opens only once every lesson before it is complete. */
async function assertCourseLessonUnlocked(tx: Transaction, userId: string, collectionId: string, resourceId: string): Promise<void> {
  const lessons = await loadCourseLessons(tx, collectionId);
  const index = lessons.findIndex((lesson) => lesson.resourceId === resourceId);
  if (index < 0) throw new AuthError("NOT_IN_COURSE", "This session only holds its course's lessons.", 422);
  const completed = await completedResourceIds(tx, userId, lessons.map((lesson) => lesson.resourceId));
  const firstOpen = lessons.findIndex((lesson) => !completed.has(lesson.resourceId));
  if (firstOpen >= 0 && index > firstOpen) throw new AuthError("LESSON_LOCKED", "Finish the lessons before this one to unlock it.", 409);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonAnchor(anchor: StudyAnchor | null | undefined): Record<string, unknown> | null {
  return anchor ? { ...anchor } : null;
}

function studyType(value: typeof resources.$inferSelect.type): StudyType | null {
  return value === "video" ? "video" : value === "paper" || value === "pdf" ? "paper" : null;
}

function safeSourceUrl(value: string | null, type: StudyType): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hosts = type === "video" ? ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"] : ["arxiv.org", "export.arxiv.org", "doi.org", "www.doi.org"];
    return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.includes(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function routeFor(type: StudyType, sessionId: string): string {
  return `/app/study/${type}/${sessionId}`;
}

function modeFor(origin: StartStudySessionRequest["origin"], type: StudyType): "guided_learning" | "research" {
  return origin === "research" || (origin === "discover" && type === "paper") ? "research" : "guided_learning";
}

function parsedAnchor(value: unknown, type: StudyType): StudyAnchor | null {
  const parsed = studyAnchorSchema.safeParse(value);
  return parsed.success && parsed.data.kind === type ? parsed.data : null;
}

function parsedReadiness(value: string): StudyResourceReadiness {
  const parsed = studyResourceReadinessSchema.safeParse(value);
  return parsed.success ? parsed.data : "preparing";
}

function parsedRole(value: string): StudySessionResource["role"] {
  const parsed = resourceRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : "related";
}

function parsedProvenanceReason(value: string | null): StudyResourceProvenance["reasonCode"] | null {
  const parsed = studyResourceProvenanceReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parsedProgressStatus(value: string | null | undefined): StudyResourceProgress["status"] {
  const parsed = progressStatusSchema.safeParse(value ?? "not_started");
  return parsed.success ? parsed.data : "not_started";
}

function resourceReadiness(resource: ResourceRecord, bindingVersionId: string | null): StudyResourceReadiness {
  const type = studyType(resource.type);
  if (!type || resource.deletedAt || resource.status === "failed" || resource.status === "archived") return "unavailable";
  if (type === "video" && !resource.video?.youtubeId && resource.status !== "pending") return "unavailable";
  if (bindingVersionId && resource.versionId === bindingVersionId && resource.versionStatus === "ready") return "ready";
  if (!bindingVersionId && resource.versionId && resource.versionStatus === "ready") return "ready";
  return parsedReadiness("preparing");
}

function emptyProgress(): StudyResourceProgress {
  return { status: "not_started", progressPct: 0, lastAnchor: null, firstStartedAt: null, lastOpenedAt: null, completedAt: null };
}

function resourceFromRow(row: {
  resource: typeof resources.$inferSelect;
  video: typeof videoDetails.$inferSelect | null;
  paper: typeof paperDetails.$inferSelect | null;
  versionId: string | null;
  versionStatus: string | null;
}): ResourceRecord {
  const type = studyType(row.resource.type);
  return {
    id: row.resource.id,
    type: row.resource.type,
    title: row.resource.title,
    description: row.resource.description,
    canonicalUrl: type ? safeSourceUrl(row.resource.canonicalUrl, type) : null,
    visibility: row.resource.visibility,
    status: row.resource.status,
    deletedAt: row.resource.deletedAt,
    currentVersionId: row.resource.currentVersionId,
    qualityScore: row.resource.qualityScore,
    versionId: row.versionId,
    versionStatus: row.versionStatus,
    video: row.video
      ? { youtubeId: row.video.youtubeId, durationMs: row.video.durationMs, channelTitle: row.video.channelTitle }
      : null,
    paper: row.paper
      ? {
          arxivId: row.paper.arxivId,
          doi: row.paper.doi,
          abstract: row.paper.abstract,
          venue: row.paper.venue,
          publicationDate: row.paper.publicationDate,
          pdfSourceUrl: safeSourceUrl(row.paper.pdfSourceUrl, "paper"),
        }
      : null,
  };
}

async function loadResource(
  tx: Transaction,
  userId: string,
  resourceId: string,
  allowUnavailable = false,
): Promise<ResourceRecord | null> {
  const row = await tx
    .select({
      resource: resources,
      video: videoDetails,
      paper: paperDetails,
      versionId: resourceVersions.id,
      versionStatus: resourceVersions.processingStatus,
    })
    .from(resources)
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .leftJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
    .where(and(
      eq(resources.id, resourceId),
      or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])),
      isNull(resources.deletedAt),
      allowUnavailable ? undefined : inArray(resources.status, ["pending", "processing", "ready"]),
    ))
    .limit(1);
  const value = row[0];
  return value ? resourceFromRow(value) : null;
}

async function lockSession(tx: Transaction, userId: string, sessionId: string): Promise<SessionRow> {
  const normalizedSessionId = studySessionIdSchema.parse(sessionId);
  await tx.execute(sql`SELECT id FROM study.study_sessions WHERE id = ${normalizedSessionId} AND user_id = ${userId} FOR UPDATE`);
  const rows = await tx
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, normalizedSessionId), eq(studySessions.userId, userId)))
    .limit(1);
  const session = rows[0];
  if (!session) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That study session is not available.", 404);
  return session;
}

async function pinReadyVersions(tx: Transaction, sessionId: string): Promise<void> {
  const rows = await tx
    .select({
      binding: sessionResources,
      resourceCurrentVersionId: resources.currentVersionId,
      versionId: resourceVersions.id,
      versionStatus: resourceVersions.processingStatus,
    })
    .from(sessionResources)
    .innerJoin(resources, eq(resources.id, sessionResources.resourceId))
    .leftJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
    .where(eq(sessionResources.studySessionId, sessionId));
  for (const row of rows) {
    if (row.binding.resourceVersionId || !row.versionId || row.versionStatus !== "ready") continue;
    await tx
      .update(sessionResources)
      .set({ resourceVersionId: row.versionId, bindingStatus: "ready" })
      .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, row.binding.resourceId), isNull(sessionResources.resourceVersionId)));
    await tx
      .update(studySessions)
      .set({ activeVersionId: row.versionId, updatedAt: new Date() })
      .where(and(eq(studySessions.id, sessionId), eq(studySessions.activeResourceId, row.binding.resourceId), isNull(studySessions.activeVersionId)));
  }
}

async function findResumableSession(tx: Transaction, userId: string, resourceId: string): Promise<SessionRow | null> {
  const rows = await tx
    .select({ session: studySessions })
    .from(studySessions)
    .innerJoin(sessionResources, eq(sessionResources.studySessionId, studySessions.id))
    .where(and(
      eq(studySessions.userId, userId),
      inArray(studySessions.status, ["active", "paused"]),
      eq(sessionResources.resourceId, resourceId),
    ))
    .orderBy(desc(studySessions.lastActiveAt))
    .limit(1);
  return rows[0]?.session ?? null;
}

async function loadProgress(tx: Transaction, userId: string, resourceId: string): Promise<ProgressRow | null> {
  const rows = await tx
    .select()
    .from(userResourceProgress)
    .where(and(eq(userResourceProgress.userId, userId), eq(userResourceProgress.resourceId, resourceId)))
    .limit(1);
  return rows[0] ?? null;
}

async function insertStudyEvent(
  tx: Transaction,
  values: typeof activityEvents.$inferInsert,
): Promise<boolean> {
  const rows = await tx
    .insert(activityEvents)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (rows[0]) await projectStudyBehavior(tx, rows[0]);
  return Boolean(rows[0]);
}

async function loadSessionBinding(tx: Transaction, sessionId: string, resourceId: string): Promise<BindingRow | null> {
  const rows = await tx
    .select()
    .from(sessionResources)
    .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, resourceId)))
    .limit(1);
  return rows[0] ?? null;
}

function activationEventKey(sessionId: string, resourceId: string, intent: "open" | "start", requestKey: string): string {
  return `study:${intent}:${sessionId}:${resourceId}:${requestKey}`;
}

async function activateResourceInTransaction(
  tx: Transaction,
  userId: string,
  sessionId: string,
  resource: ResourceRecord,
  role: StudySessionResource["role"] | undefined,
  anchor: StudyAnchor | undefined,
  eventContext: { origin: string; correlationId: string; intent: "open" | "start"; requestKey: string; recommendationRunId?: string },
): Promise<{ session: SessionRow; binding: BindingRow; progress: ProgressRow | null; resourceVersionId: string | null; eventInserted: boolean }> {
  const session = await lockSession(tx, userId, sessionId);
  const type = studyType(resource.type);
  if (!type) throw new AuthError("UNSUPPORTED_STUDY_RESOURCE", "This material does not have a study experience yet.", 422);
  const previousResourceId = session.activeResourceId;
  const currentBinding = await loadSessionBinding(tx, sessionId, resource.id);
  const sameRequestedAnchor = anchor === undefined || JSON.stringify(parsedAnchor(session.activeAnchor, type)) === JSON.stringify(anchor);
  if (session.status === "active" && previousResourceId === resource.id && sameRequestedAnchor && currentBinding) {
    let binding = currentBinding;
    let activeSession = session;
    if (!binding.resourceVersionId && resource.versionId && resource.versionStatus === "ready") {
      const [updated] = await tx
        .update(sessionResources)
        .set({ resourceVersionId: resource.versionId, bindingStatus: "ready" })
        .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, resource.id)))
        .returning();
      if (updated) binding = updated;
    }
    if (binding.resourceVersionId && session.activeVersionId !== binding.resourceVersionId) {
      const [updated] = await tx
        .update(studySessions)
        .set({ activeVersionId: binding.resourceVersionId, updatedAt: new Date() })
        .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
        .returning();
      if (updated) activeSession = updated;
    }
    return { session: activeSession, binding, progress: await loadProgress(tx, userId, resource.id), resourceVersionId: binding.resourceVersionId, eventInserted: false };
  }
  let previousType: StudyType | null = null;
  let previousAnchor: StudyAnchor | null = null;
  if (previousResourceId && previousResourceId !== resource.id) {
    const previousRows = await tx
      .select({ resource: resources })
      .from(sessionResources)
      .innerJoin(resources, eq(resources.id, sessionResources.resourceId))
      .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, previousResourceId)))
      .limit(1);
    previousType = previousRows[0] ? studyType(previousRows[0].resource.type) : null;
    previousAnchor = previousType ? parsedAnchor(session.activeAnchor, previousType) : null;
    if (previousAnchor) {
      await tx
        .update(sessionResources)
        .set({ lastAnchor: jsonAnchor(previousAnchor), lastOpenedAt: new Date() })
        .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, previousResourceId)));
      if (session.activeVersionId) {
        await tx.insert(sessionCheckpoints).values({
          studySessionId: sessionId,
          kind: "resume",
          resourceId: previousResourceId,
          resourceVersionId: session.activeVersionId,
          anchor: jsonAnchor(previousAnchor),
          label: "Return to this material",
        });
      }
    }
  }

  let binding = currentBinding;
  if (!binding) {
    const positionRows = await tx
      .select({ value: max(sessionResources.position) })
      .from(sessionResources)
      .where(eq(sessionResources.studySessionId, sessionId));
    const introduction = eventContext.origin === "related" && previousResourceId && previousResourceId !== resource.id && previousType && previousType !== type
      ? {
          introducedByResourceId: previousResourceId,
          introducedFromAnchor: jsonAnchor(previousAnchor),
          introducedReasonCode: previousType === "paper" ? "related_explanation" : "deeper_dive",
        }
      : {};
    const [created] = await tx
      .insert(sessionResources)
      .values({
        studySessionId: sessionId,
        resourceId: resource.id,
        resourceVersionId: resource.versionId && resource.versionStatus === "ready" ? resource.versionId : null,
        bindingStatus: resource.versionId && resource.versionStatus === "ready" ? "ready" : "preparing",
        role: role ?? "related",
        position: Number(positionRows[0]?.value ?? -1) + 1,
        addedBy: eventContext.origin === "related" ? "related" : "user",
        ...introduction,
      })
      .returning();
    if (!created) throw new Error("Study material could not be attached");
    binding = created;
  } else if (!binding.resourceVersionId && resource.versionId && resource.versionStatus === "ready") {
    const [updated] = await tx
      .update(sessionResources)
      .set({ resourceVersionId: resource.versionId, bindingStatus: "ready" })
      .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, resource.id)))
      .returning();
    if (updated) binding = updated;
  }
  if (!binding) throw new Error("Study material could not be attached");

  if (!binding.introducedByResourceId && eventContext.origin === "related" && previousResourceId && previousResourceId !== resource.id && previousType && previousType !== type) {
    const [updated] = await tx
      .update(sessionResources)
      .set({
        introducedByResourceId: previousResourceId,
        introducedFromAnchor: jsonAnchor(previousAnchor),
        introducedReasonCode: previousType === "paper" ? "related_explanation" : "deeper_dive",
      })
      .where(and(eq(sessionResources.studySessionId, sessionId), eq(sessionResources.resourceId, resource.id)))
      .returning();
    if (updated) binding = updated;
  }

  const previousProgress = await loadProgress(tx, userId, resource.id);
  const targetAnchor = anchor ?? parsedAnchor(binding.lastAnchor, type) ?? parsedAnchor(previousProgress?.lastAnchor, type);
  const now = new Date();
  const [updatedSession] = await tx
    .update(studySessions)
    .set({
      activeResourceId: resource.id,
      activeVersionId: binding.resourceVersionId,
      activeAnchor: jsonAnchor(targetAnchor),
      status: "active",
      lastActiveAt: now,
      updatedAt: now,
      lockVersion: sql`${studySessions.lockVersion} + 1`,
    })
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
    .returning();
  if (!updatedSession) throw new Error("Study session could not be activated");

  const progressValues = {
    userId,
    resourceId: resource.id,
    lastSessionId: sessionId,
    status: "active",
    progressPct: previousProgress?.progressPct ?? 0,
    lastAnchor: jsonAnchor(targetAnchor),
    firstStartedAt: previousProgress?.firstStartedAt ?? now,
    lastOpenedAt: now,
    completedAt: previousProgress?.completedAt ?? null,
    updatedAt: now,
  } satisfies typeof userResourceProgress.$inferInsert;
  await tx
    .insert(userResourceProgress)
    .values(progressValues)
    .onConflictDoUpdate({
      target: [userResourceProgress.userId, userResourceProgress.resourceId],
      set: {
        lastSessionId: sessionId,
        status: "active",
        progressPct: previousProgress?.progressPct ?? 0,
        lastAnchor: jsonAnchor(targetAnchor),
        firstStartedAt: previousProgress?.firstStartedAt ?? now,
        lastOpenedAt: now,
        updatedAt: now,
      },
    });

  const eventInserted = await insertStudyEvent(tx, {
    schemaVersion: 1,
    userId,
    studySessionId: sessionId,
    resourceId: resource.id,
    resourceVersionId: binding.resourceVersionId,
    eventType: "resource.opened",
    actorType: "user",
    source: "web",
    correlationId: eventContext.correlationId,
    idempotencyKey: activationEventKey(sessionId, resource.id, eventContext.intent, eventContext.requestKey),
    occurredAt: now,
    payload: { origin: eventContext.origin, intent: eventContext.intent, runId: eventContext.recommendationRunId ?? null, progressFraction: (previousProgress?.progressPct ?? 0) / 100 },
  });
  return { session: updatedSession, binding, progress: previousProgress, resourceVersionId: binding.resourceVersionId, eventInserted };
}

function responseFor(sessionId: string, resource: ResourceRecord, readiness: StudyResourceReadiness, resumed: boolean): StartStudySessionResponse {
  const type = studyType(resource.type);
  if (!type) throw new AuthError("UNSUPPORTED_STUDY_RESOURCE", "This material does not have a study experience yet.", 422);
  return { sessionId, route: routeFor(type, sessionId), resourceType: type, readiness, resumed };
}

function responseFromIdempotency(value: Record<string, unknown> | null): StartStudySessionResponse | null {
  if (!value || typeof value.sessionId !== "string" || typeof value.route !== "string" || typeof value.resourceType !== "string" || typeof value.readiness !== "string" || typeof value.resumed !== "boolean") return null;
  const type = value.resourceType === "video" || value.resourceType === "paper" ? value.resourceType : null;
  const readiness = studyResourceReadinessSchema.safeParse(value.readiness);
  return type && readiness.success ? { sessionId: value.sessionId, route: value.route, resourceType: type, readiness: readiness.data, resumed: value.resumed } : null;
}

function requestHash(input: StartStudySessionRequest): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function startOrResumeInTransaction(tx: Transaction, userId: string, input: StartStudySessionRequest): Promise<StartStudySessionResponse> {
  const normalized = startStudySessionRequestSchema.parse(input);
  const scope = `study.start:${userId}`;
  const hash = requestHash(normalized);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${normalized.idempotencyKey}`}, 0))`);
  const existingIdempotency = await tx
    .select()
    .from(idempotencyRecords)
    .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.idempotencyKey, normalized.idempotencyKey)))
    .limit(1);
  const existingRecord = existingIdempotency[0];
  if (existingRecord) {
    if (existingRecord.requestSha256 !== hash) throw new AuthError("IDEMPOTENCY_KEY_REUSED", "Use a new idempotency key for a different study start.", 409);
    const response = existingRecord.status === "completed" ? responseFromIdempotency(existingRecord.responseBody) : null;
    if (response) return response;
    throw new AuthError("STUDY_START_IN_PROGRESS", "That study start is still being processed.", 409);
  }
  const claimed = await tx.execute<IdempotencyResult>(sql`
    SELECT status, response_body
    FROM ops.claim_idempotency(
      ${scope},
      ${normalized.idempotencyKey},
      ${hash}::char(64),
      ${new Date(Date.now() + 86_400_000).toISOString()}
    )
  `);
  if (claimed[0]?.status === "completed") {
    const response = responseFromIdempotency(claimed[0].response_body);
    if (response) return response;
    throw new AuthError("IDEMPOTENCY_RESPONSE_UNAVAILABLE", "The previous study start response is unavailable.", 500);
  }

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.start.resource:${userId}:${normalized.resourceId}`}, 0))`);
  const resource = await loadResource(tx, userId, normalized.resourceId);
  const type = resource ? studyType(resource.type) : null;
  if (!resource || !type) throw new AuthError("RESOURCE_NOT_AVAILABLE", "This material is not ready to study here.", 404);
  if (normalized.recommendationRunId) {
    const run = await tx
      .select({ id: recommendationRuns.id })
      .from(recommendationRuns)
      .where(and(eq(recommendationRuns.id, normalized.recommendationRunId), eq(recommendationRuns.userId, userId)))
      .limit(1);
    const candidate = await tx
      .select({ resourceId: recommendationCandidates.resourceId })
      .from(recommendationCandidates)
      .where(and(eq(recommendationCandidates.recommendationRunId, normalized.recommendationRunId), eq(recommendationCandidates.resourceId, normalized.resourceId)))
      .limit(1);
    if (!run[0] || !candidate[0]) throw new AuthError("INVALID_RECOMMENDATION_CONTEXT", "That recommendation is no longer available.", 422);
  }

  let session = await findResumableSession(tx, userId, normalized.resourceId);
  const current = await currentSessionInTransaction(tx, userId);
  if (current && current.id !== session?.id) throw sessionInProgress();
  const resumedCourse = session ? courseOf(session) : null;
  if (resumedCourse) await assertCourseLessonUnlocked(tx, userId, resumedCourse.collectionId, normalized.resourceId);
  const resumed = Boolean(session);
  if (!session) {
    const [created] = await tx
      .insert(studySessions)
      .values({
        userId,
        title: resource.title,
        mode: normalized.mode ?? modeFor(normalized.origin, type),
        status: "active",
        metadata: { startedFrom: normalized.origin },
      })
      .returning();
    session = created ?? null;
  }
  if (!session) throw new Error("Study session could not be created");
  const correlationId = normalized.correlationId ?? randomUUID();
  const activated = await activateResourceInTransaction(
    tx,
    userId,
    session.id,
    resource,
    resumed ? undefined : "primary",
    undefined,
    { origin: normalized.origin, correlationId, intent: "start", requestKey: normalized.idempotencyKey, ...(normalized.recommendationRunId ? { recommendationRunId: normalized.recommendationRunId } : {}) },
  );
  if (normalized.recommendationRunId) {
    const previousRuns = session.metadata.recommendationRuns;
    await tx.update(studySessions).set({ metadata: { ...session.metadata, recommendationRuns: { ...(previousRuns && typeof previousRuns === "object" && !Array.isArray(previousRuns) ? previousRuns : {}), [normalized.resourceId]: normalized.recommendationRunId } } }).where(eq(studySessions.id, session.id));
  }
  if (activated.eventInserted && (normalized.origin === "home" || normalized.origin === "discover" || normalized.origin === "research")) {
    await tx.insert(discoveryInteractions).values({
      userId,
      resourceId: normalized.resourceId,
      action: "start_session",
      correlationId,
      metadata: {
        recommendationRunId: normalized.recommendationRunId ?? null,
        origin: normalized.origin,
        studySessionId: session.id,
      },
    }).onConflictDoNothing();
  }
  if (normalized.collectionId && normalized.collectionItemId) {
    await tx
      .insert(collectionEnrollments)
      .values({ userId, collectionId: normalized.collectionId, currentItemId: normalized.collectionItemId, status: "active", progressPct: 0 })
      .onConflictDoUpdate({ target: [collectionEnrollments.userId, collectionEnrollments.collectionId], set: { currentItemId: normalized.collectionItemId, status: "active", updatedAt: new Date() } });
  }
  const response = responseFor(session.id, resource, resourceReadiness(resource, activated.resourceVersionId), resumed);
  await tx.execute<IdempotencyResult>(sql`
    SELECT status, response_body
    FROM ops.complete_idempotency(
      ${scope},
      ${normalized.idempotencyKey},
      'completed',
      200,
      ${JSON.stringify(response)}::jsonb,
      ${normalized.resourceId}
    )
  `);
  return response;
}

export async function startOrResumeStudySession(userId: string, input: StartStudySessionRequest): Promise<StartStudySessionResponse> {
  const response = await withUserTransaction(userId, (tx) => startOrResumeInTransaction(tx, userId, input));
  await invalidateHomeFeedCache(userId);
  return response;
}

export async function getStudySession(userId: string, sessionId: string): Promise<StudySessionView> {
  const normalizedSessionId = studySessionIdSchema.parse(sessionId);
  return withUserTransaction(userId, async (tx) => {
    await pinReadyVersions(tx, normalizedSessionId);
    const sessions = await tx
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.id, normalizedSessionId), eq(studySessions.userId, userId)))
      .limit(1);
    const session = sessions[0];
    if (!session) throw new AuthError("STUDY_SESSION_NOT_FOUND", "That study session is not available.", 404);
    const rows = await tx
      .select({
        binding: sessionResources,
        resource: resources,
        video: videoDetails,
        paper: paperDetails,
        versionId: resourceVersions.id,
        versionStatus: resourceVersions.processingStatus,
      })
      .from(sessionResources)
      .innerJoin(resources, eq(resources.id, sessionResources.resourceId))
      .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
      .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
      .leftJoin(resourceVersions, eq(resourceVersions.id, sessionResources.resourceVersionId))
      .where(eq(sessionResources.studySessionId, normalizedSessionId))
      .orderBy(asc(sessionResources.position));
    const joined: JoinedBinding[] = rows.flatMap((row) => studyType(row.resource.type) ? [{ binding: row.binding, resource: resourceFromRow(row) }] : []);
    const resourceIds = joined.map((row) => row.resource.id);
    const [progressRows, conceptRows, authorRows, checkpointRows, chunks] = await Promise.all([
      resourceIds.length > 0
        ? tx.select().from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, resourceIds)))
        : Promise.resolve([] as ProgressRow[]),
      resourceIds.length > 0
        ? tx.select({ resourceId: resourceConcepts.resourceId, id: concepts.id, name: concepts.name, relevance: resourceConcepts.relevance, isPrimary: resourceConcepts.isPrimary }).from(resourceConcepts).innerJoin(concepts, eq(concepts.id, resourceConcepts.conceptId)).where(inArray(resourceConcepts.resourceId, resourceIds))
        : Promise.resolve([]),
      resourceIds.length > 0
        ? tx.select({ resourceId: paperAuthors.paperResourceId, name: authors.preferredName }).from(paperAuthors).innerJoin(authors, eq(authors.id, paperAuthors.authorId)).where(inArray(paperAuthors.paperResourceId, resourceIds)).orderBy(asc(paperAuthors.ordinal))
        : Promise.resolve([]),
      tx.select().from(sessionCheckpoints).where(eq(sessionCheckpoints.studySessionId, normalizedSessionId)).orderBy(desc(sessionCheckpoints.createdAt)).limit(30),
      session.activeVersionId
        ? tx.select({ id: resourceChunks.id, chunkType: resourceChunks.chunkType, content: resourceChunks.content, startMs: resourceChunks.startMs, endMs: resourceChunks.endMs, pageFrom: resourceChunks.pageFrom, pageTo: resourceChunks.pageTo, headingPath: resourceChunks.headingPath }).from(resourceChunks).where(eq(resourceChunks.resourceVersionId, session.activeVersionId)).orderBy(asc(resourceChunks.ordinal)).limit(initialStudyChunkLimit)
        : Promise.resolve([]),
    ]);
    const progressByResource = new Map(progressRows.map((row) => [row.resourceId, row]));
    const conceptsByResource = new Map<string, Array<{ id: string; name: string; relevance: number; isPrimary: boolean }>>();
    for (const row of conceptRows) {
      const values = conceptsByResource.get(row.resourceId) ?? [];
      values.push({ id: row.id, name: row.name, relevance: Number(row.relevance), isPrimary: row.isPrimary });
      conceptsByResource.set(row.resourceId, values);
    }
    const authorsByResource = new Map<string, string[]>();
    for (const row of authorRows) authorsByResource.set(row.resourceId, [...(authorsByResource.get(row.resourceId) ?? []), row.name]);
    const build = (row: JoinedBinding, includeChunks: boolean): StudySessionResource => {
      const type = studyType(row.resource.type);
      if (!type) throw new Error("Unsupported session resource");
      const progress = progressByResource.get(row.resource.id);
      const source = row.binding.introducedByResourceId
        ? joined.find((candidate) => candidate.resource.id === row.binding.introducedByResourceId)
        : null;
      const reasonCode = parsedProvenanceReason(row.binding.introducedReasonCode);
      const sourceType = source ? studyType(source.resource.type) : null;
      const introducedFromCandidate = source && sourceType && reasonCode
        ? {
            resourceId: source.resource.id,
            title: source.resource.title,
            type: sourceType,
            anchor: parsedAnchor(row.binding.introducedFromAnchor, sourceType),
            reasonCode,
          }
        : null;
      const introducedFrom = introducedFromCandidate
        ? studyResourceProvenanceSchema.safeParse(introducedFromCandidate).data ?? null
        : null;
      return {
        resourceId: row.resource.id,
        type,
        title: row.resource.title,
        description: row.resource.description,
        role: parsedRole(row.binding.role),
        position: row.binding.position,
        introducedFrom,
        resourceVersionId: row.binding.resourceVersionId,
        readiness: resourceReadiness(row.resource, row.binding.resourceVersionId),
        lastAnchor: parsedAnchor(row.binding.lastAnchor ?? progress?.lastAnchor, type),
        progress: progress
          ? { status: parsedProgressStatus(progress.status), progressPct: Number(progress.progressPct ?? 0), lastAnchor: parsedAnchor(progress.lastAnchor, type), firstStartedAt: iso(progress.firstStartedAt), lastOpenedAt: iso(progress.lastOpenedAt), completedAt: iso(progress.completedAt) }
          : emptyProgress(),
        canonicalUrl: row.resource.canonicalUrl,
        video: type === "video" && row.resource.video ? row.resource.video : null,
        paper: type === "paper" && row.resource.paper ? { ...row.resource.paper, authors: authorsByResource.get(row.resource.id) ?? [] } : null,
        concepts: conceptsByResource.get(row.resource.id) ?? [],
        chunks: includeChunks ? chunks.map((chunk) => ({ ...chunk, headingPath: chunk.headingPath ?? [] })) : [],
      };
    };
    const activeJoined = joined.find((row) => row.resource.id === session.activeResourceId) ?? null;
    const resourcesView = joined.map((row) => build(row, row.resource.id === session.activeResourceId));
    const activeResource = resourcesView.find((item) => item.resourceId === session.activeResourceId) ?? null;
    const related = await findRelatedResources(tx, userId, activeJoined?.resource ?? null);
    const course = await courseView(tx, userId, session);
    return {
      id: session.id,
      title: session.title ?? activeResource?.title ?? "Study session",
      mode: sessionModeSchema.parse(session.mode),
      status: session.status,
      startedAt: iso(session.startedAt) ?? new Date(0).toISOString(),
      lastActiveAt: iso(session.lastActiveAt) ?? new Date(0).toISOString(),
      activeResourceId: session.activeResourceId,
      activeAnchor: activeResource ? parsedAnchor(session.activeAnchor, activeResource.type) : null,
      resources: resourcesView,
      activeResource,
      checkpoints: checkpointRows.map((checkpoint) => {
        const parsed = studyAnchorSchema.safeParse(checkpoint.anchor);
        return { id: checkpoint.id, resourceId: checkpoint.resourceId, kind: checkpoint.kind, label: checkpoint.label, anchor: parsed.success ? parsed.data : null, createdAt: iso(checkpoint.createdAt) ?? new Date(0).toISOString() };
      }),
      related,
      course,
    };
  });
}

async function courseView(tx: Transaction, userId: string, session: SessionRow): Promise<StudySessionCourse | null> {
  const course = courseOf(session);
  if (!course) return null;
  const lessons = await loadCourseLessons(tx, course.collectionId);
  const progressRows = lessons.length > 0
    ? await tx.select().from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, lessons.map((lesson) => lesson.resourceId))))
    : [];
  const progressByResource = new Map(progressRows.map((row) => [row.resourceId, row]));
  const sections: StudySessionCourse["sections"] = [];
  for (const lesson of lessons) {
    const progress = progressByResource.get(lesson.resourceId);
    const state = progress?.status === "completed" ? "completed" : lesson.resourceId === session.activeResourceId ? "current" : "locked";
    let section = sections.at(-1);
    if (section?.id !== lesson.sectionId) {
      section = { id: lesson.sectionId, title: lesson.sectionTitle, lessons: [] };
      sections.push(section);
    }
    section.lessons.push({ resourceId: lesson.resourceId, title: lesson.title, youtubeId: lesson.youtubeId, channelTitle: lesson.channelTitle, state, progressPct: Number(progress?.progressPct ?? 0) });
  }
  return { collectionId: course.collectionId, slug: course.slug, title: session.title ?? "Course", sections };
}

async function findRelatedResources(tx: Transaction, userId: string, current: ResourceRecord | null): Promise<StudySessionResource[]> {
  if (!current) return [];
  const currentConcepts = await tx
    .select({ conceptId: resourceConcepts.conceptId, relevance: resourceConcepts.relevance, isPrimary: resourceConcepts.isPrimary })
    .from(resourceConcepts)
    .where(eq(resourceConcepts.resourceId, current.id));
  if (currentConcepts.length === 0) return [];
  const removed = await tx
    .select({ resourceId: libraryItems.resourceId })
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.status, "removed")));
  const removedIds = removed.map((row) => row.resourceId);
  const targetType: StudyType = current.type === "video" ? "paper" : "video";
  const rows = await tx
    .select({ resource: resources, video: videoDetails, paper: paperDetails, versionId: resourceVersions.id, versionStatus: resourceVersions.processingStatus, conceptId: resourceConcepts.conceptId, relevance: resourceConcepts.relevance, isPrimary: resourceConcepts.isPrimary })
    .from(resourceConcepts)
    .innerJoin(resources, eq(resources.id, resourceConcepts.resourceId))
    .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
    .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
    .leftJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
    .where(and(
      inArray(resourceConcepts.conceptId, currentConcepts.map((concept) => concept.conceptId)),
      eq(resources.type, targetType),
      ne(resources.id, current.id),
      or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])),
      inArray(resources.status, ["pending", "processing", "ready"]),
      isNull(resources.deletedAt),
      removedIds.length > 0 ? notInArray(resources.id, removedIds) : undefined,
    ))
    .limit(200);
  const currentByConcept = new Map(currentConcepts.map((concept) => [concept.conceptId, { relevance: Number(concept.relevance), isPrimary: concept.isPrimary }]));
  const scored = new Map<string, { resource: ResourceRecord; score: number }>();
  for (const row of rows) {
    const source = currentByConcept.get(row.conceptId);
    if (!source) continue;
    const resource = resourceFromRow(row);
    const readiness = resourceReadiness(resource, resource.versionId);
    if (readiness === "unavailable") continue;
    const conceptScore = source.relevance * Number(row.relevance) * (source.isPrimary ? 1.25 : 1) * (row.isPrimary ? 1.25 : 1);
    const qualityScore = Math.min(1, Math.max(0, resource.qualityScore ?? 0.5));
    const readinessScore = readiness === "ready" ? 1 : 0.4;
    const score = conceptScore * 0.75 + qualityScore * 0.15 + readinessScore * 0.1;
    const previous = scored.get(resource.id);
    scored.set(resource.id, { resource, score: (previous?.score ?? 0) + score });
  }
  return [...scored.values()]
    .sort((left, right) => right.score - left.score || (right.resource.status === "ready" ? 1 : 0) - (left.resource.status === "ready" ? 1 : 0) || left.resource.title.localeCompare(right.resource.title))
    .slice(0, 3)
    .map(({ resource }) => {
      const type = studyType(resource.type);
      if (!type) throw new Error("Unsupported related resource");
      return {
        resourceId: resource.id,
        type,
        title: resource.title,
        description: resource.description,
        role: "related",
        position: 0,
        introducedFrom: null,
        resourceVersionId: null,
        readiness: resourceReadiness(resource, null),
        lastAnchor: null,
        progress: emptyProgress(),
        canonicalUrl: resource.canonicalUrl,
        video: type === "video" ? resource.video : null,
        paper: type === "paper" && resource.paper ? { ...resource.paper, authors: [] } : null,
        concepts: [],
        chunks: [],
      } satisfies StudySessionResource;
    });
}

export async function attachSessionResource(userId: string, sessionId: string, input: ActivateSessionResourceRequest): Promise<StartStudySessionResponse> {
  const normalizedSessionId = studySessionIdSchema.parse(sessionId);
  const normalized = activateSessionResourceRequestSchema.parse(input);
  const scope = `study.resource.activate:${userId}:${normalizedSessionId}`;
  const hash = createHash("sha256").update(JSON.stringify({ resourceId: normalized.resourceId, role: normalized.role ?? null, anchor: normalized.anchor ?? null })).digest("hex");
  const response = await withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${normalized.idempotencyKey}`}, 0))`);
    const existingIdempotency = await tx
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.idempotencyKey, normalized.idempotencyKey)))
      .limit(1);
    const existingRecord = existingIdempotency[0];
    if (existingRecord) {
      if (existingRecord.requestSha256 !== hash) throw new AuthError("IDEMPOTENCY_KEY_REUSED", "Use a new idempotency key for a different material activation.", 409);
      const replay = existingRecord.status === "completed" ? responseFromIdempotency(existingRecord.responseBody) : null;
      if (replay) return replay;
      throw new AuthError("STUDY_RESOURCE_ACTIVATION_IN_PROGRESS", "That material activation is still being processed.", 409);
    }
    const claimed = await tx.execute<IdempotencyResult>(sql`
      SELECT status, response_body
      FROM ops.claim_idempotency(
        ${scope},
        ${normalized.idempotencyKey},
        ${hash}::char(64),
        ${new Date(Date.now() + 86_400_000).toISOString()}
      )
    `);
    if (claimed[0]?.status === "completed") {
      const replay = responseFromIdempotency(claimed[0].response_body);
      if (replay) return replay;
      throw new AuthError("IDEMPOTENCY_RESPONSE_UNAVAILABLE", "The previous material activation response is unavailable.", 500);
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.resource.activate:${userId}:${normalizedSessionId}:${normalized.resourceId}`}, 0))`);
    const resource = await loadResource(tx, userId, normalized.resourceId);
    const type = resource ? studyType(resource.type) : null;
    if (!resource || !type) throw new AuthError("RESOURCE_NOT_AVAILABLE", "This material is not ready to study here.", 404);
    const course = courseOf(await lockSession(tx, userId, normalizedSessionId));
    if (course) await assertCourseLessonUnlocked(tx, userId, course.collectionId, normalized.resourceId);
    const activated = await activateResourceInTransaction(
      tx,
      userId,
      normalizedSessionId,
      resource,
      normalized.role && normalized.role !== "primary" ? normalized.role : "related",
      normalized.anchor,
      { origin: normalized.role === "related" ? "related" : "session", correlationId: randomUUID(), intent: "open", requestKey: normalized.idempotencyKey },
    );
    const response = responseFor(normalizedSessionId, resource, resourceReadiness(resource, activated.resourceVersionId), true);
    await tx.execute<IdempotencyResult>(sql`
      SELECT status, response_body
      FROM ops.complete_idempotency(
        ${scope},
        ${normalized.idempotencyKey},
        'completed',
        200,
        ${JSON.stringify(response)}::jsonb,
        ${normalized.resourceId}
      )
    `);
    return response;
  });
  await invalidateHomeFeedCache(userId);
  return response;
}

async function advanceCollectionEnrollment(tx: Transaction, userId: string, resourceId: string): Promise<void> {
  const rows = await tx
    .select({ enrollment: collectionEnrollments, item: collectionItems })
    .from(collectionEnrollments)
    .innerJoin(collectionItems, eq(collectionItems.id, collectionEnrollments.currentItemId))
    .where(and(eq(collectionEnrollments.userId, userId), eq(collectionItems.resourceId, resourceId), eq(collectionEnrollments.status, "active")));
  for (const row of rows) {
    const items = await tx
      .select({ item: collectionItems })
      .from(collectionItems)
      .innerJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
      .where(eq(collectionSections.collectionId, row.enrollment.collectionId))
      .orderBy(asc(collectionSections.position), asc(collectionItems.position));
    const index = items.findIndex((item) => item.item.id === row.item.id);
    const next = items.slice(index + 1).find((item) => item.item.required);
    const completedCount = Math.min(items.length, index + 1);
    await tx
      .update(collectionEnrollments)
      .set({ currentItemId: next?.item.id ?? row.item.id, status: next ? "active" : "completed", progressPct: items.length === 0 ? 100 : (completedCount / items.length) * 100, completedAt: next ? null : new Date(), updatedAt: new Date() })
      .where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.collectionId, row.enrollment.collectionId)));
  }
}

/** A finished course hands over to the oldest one in the learner's queue, so Sessions always holds what is next. */
async function startNextQueuedCollection(tx: Transaction, userId: string): Promise<void> {
  // A queued enrollment's started_at is when it joined the queue.
  const [queued] = await tx.select({ collectionId: collectionEnrollments.collectionId }).from(collectionEnrollments).where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.status, "queued"))).orderBy(asc(collectionEnrollments.startedAt)).limit(1);
  if (!queued) return;
  // A savepoint: a course that cannot start must not undo the progress being saved.
  await tx.transaction((savepoint) => startCollectionInTransaction(savepoint, userId, queued.collectionId, randomUUID())).catch((error: unknown) => console.warn(JSON.stringify({ metric: "queue_advance_failure", collectionId: queued.collectionId, error: error instanceof Error ? error.message : "start failed" })));
}

export async function updateStudyProgress(userId: string, sessionId: string, input: StudyProgressRequest): Promise<StudyProgressResponse> {
  const normalizedSessionId = studySessionIdSchema.parse(sessionId);
  return withUserTransaction(userId, async (tx) => {
    const session = await lockSession(tx, userId, normalizedSessionId);
    if (session.activeResourceId !== input.resourceId) throw new AuthError("INACTIVE_STUDY_RESOURCE", "Switch to this material before saving progress.", 409);
    const resource = await loadResource(tx, userId, input.resourceId, true);
    const type = resource ? studyType(resource.type) : null;
    if (!resource || !type || input.anchor.kind !== type) throw new AuthError("INVALID_STUDY_ANCHOR", "That progress anchor does not match this material.", 422);
    if (input.event === "seek" && type !== "video") throw new AuthError("INVALID_PROGRESS_EVENT", "Paper progress cannot use a video seek event.", 422);
    if (input.event === "complete" && input.progressPct < 95) throw new AuthError("INVALID_COMPLETION", "Complete the material before marking it complete.", 422);
    await tx.execute(sql`SELECT user_id FROM study.user_resource_progress WHERE user_id = ${userId} AND resource_id = ${input.resourceId} FOR UPDATE`);
    const previous = await loadProgress(tx, userId, input.resourceId);
    const previousPct = Number(previous?.progressPct ?? 0);
    const stale = input.event === "checkpoint" && input.progressPct < previousPct;
    const progressPct = stale ? previousPct : Math.max(previousPct, input.progressPct);
    const eventType = input.event === "complete" ? "resource.completed" : input.event === "play" ? "video.played" : input.event === "pause" ? type === "video" ? "video.paused" : "resource.progressed" : input.event === "seek" ? "video.seeked" : "resource.progressed";
    const milestone = input.event === "complete" ? "completed" : input.event === "checkpoint" ? [90, 75, 50, 25].find((value) => previousPct < value && progressPct >= value)?.toString() ?? null : null;
    const now = new Date();
    const [time] = await tx.select({ seconds: sql<number>`COALESCE(sum(${focusSessions.durationSec}), 0)::int` }).from(focusSessions)
      .where(and(eq(focusSessions.userId, userId), eq(focusSessions.studySessionId, normalizedSessionId), eq(focusSessions.resourceId, input.resourceId)));
    const watchedSeconds = Number(time?.seconds ?? 0);
    const attribution = session.metadata.recommendationRuns as Record<string, string> | undefined;
    const eventInserted = stale ? false : await insertStudyEvent(tx, {
      schemaVersion: 1,
      userId,
      studySessionId: normalizedSessionId,
      resourceId: input.resourceId,
      resourceVersionId: session.activeVersionId,
      eventType,
      actorType: "user",
      source: "web",
      idempotencyKey: `study:${milestone ? "milestone" : "progress"}:${normalizedSessionId}:${input.resourceId}:${milestone ?? input.idempotencyKey}`,
      occurredAt: now,
      payload: { progressPct, watchedSeconds, milestone, runId: attribution?.[input.resourceId] ?? null, anchor: jsonAnchor(input.anchor), event: input.event },
    });
    const shouldPersist = !stale && (eventInserted || input.event === "checkpoint");
    if (shouldPersist) {
      await tx
        .insert(userResourceProgress)
        .values({
          userId,
          resourceId: input.resourceId,
          lastSessionId: normalizedSessionId,
          status: input.event === "complete" ? "completed" : "active",
          progressPct,
          lastAnchor: jsonAnchor(input.anchor),
          firstStartedAt: previous?.firstStartedAt ?? now,
          lastOpenedAt: previous?.lastOpenedAt ?? now,
          completedAt: input.event === "complete" ? now : previous?.completedAt ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userResourceProgress.userId, userResourceProgress.resourceId],
          set: {
            lastSessionId: normalizedSessionId,
            status: input.event === "complete" ? "completed" : previous?.status === "completed" && progressPct >= 100 ? "completed" : "active",
            progressPct,
            lastAnchor: jsonAnchor(input.anchor),
            lastOpenedAt: now,
            completedAt: input.event === "complete" ? now : previous?.completedAt ?? null,
            updatedAt: now,
          },
        });
      await tx.update(sessionResources).set({ lastAnchor: jsonAnchor(input.anchor), lastOpenedAt: now }).where(and(eq(sessionResources.studySessionId, normalizedSessionId), eq(sessionResources.resourceId, input.resourceId)));
      await tx.update(studySessions).set({ activeAnchor: jsonAnchor(input.anchor), lastActiveAt: now, updatedAt: now, lockVersion: sql`${studySessions.lockVersion} + 1` }).where(eq(studySessions.id, normalizedSessionId));
      if (eventInserted && input.event === "complete") {
        await advanceCollectionEnrollment(tx, userId, input.resourceId);
        // Last, so a finished session has made room before the next queued course starts.
        if (await advanceSessionAfterCompletion(tx, userId, session, input.resourceId)) await startNextQueuedCollection(tx, userId);
      }
    }
    if (eventInserted && input.event === "pause" && type === "video" && watchedSeconds < 30 && progressPct < 10 && now.getTime() - session.startedAt.getTime() < 120_000) {
      await insertStudyEvent(tx, { schemaVersion: 1, userId, studySessionId: normalizedSessionId, resourceId: input.resourceId, eventType: "resource.abandoned", actorType: "user", source: "web", idempotencyKey: `study:abandon:${normalizedSessionId}:${input.resourceId}`, occurredAt: now, payload: { progressPct, watchedSeconds, runId: attribution?.[input.resourceId] ?? null } });
    }
    const status = input.event === "complete" ? "completed" : previous?.status === "completed" && progressPct >= 100 ? "completed" : "active";
    return { sessionId: normalizedSessionId, resourceId: input.resourceId, progressPct, status };
  });
}

export async function pauseSession(userId: string, sessionId: string, idempotencyKey: string, action: "pause" | "complete"): Promise<void> {
  const normalizedSessionId = studySessionIdSchema.parse(sessionId);
  await withUserTransaction(userId, async (tx) => {
    const session = await lockSession(tx, userId, normalizedSessionId);
    const now = new Date();
    const eventType = action === "pause" ? "session.paused" : "session.completed";
    const eventInserted = await insertStudyEvent(tx, { schemaVersion: 1, userId, studySessionId: normalizedSessionId, resourceId: session.activeResourceId, resourceVersionId: session.activeVersionId, eventType, actorType: "user", source: "web", idempotencyKey: `study:session:${normalizedSessionId}:${idempotencyKey}`, occurredAt: now, payload: { action } });
    if (!eventInserted) return;
    await tx.update(studySessions).set({ status: action === "pause" ? "paused" : "completed", endedAt: action === "pause" ? null : now, lastActiveAt: now, updatedAt: now, lockVersion: sql`${studySessions.lockVersion} + 1` }).where(and(eq(studySessions.id, normalizedSessionId), eq(studySessions.userId, userId)));
    // A completed session leaves Sessions empty, so the next queued Library course can start.
    if (action === "complete") await startNextQueuedCollection(tx, userId);
  });
}

/** Counts a tutor question as study activity (Home stats, plan levels), once per request. */
export async function recordStudyQuestion(tx: Transaction, input: { userId: string; sessionId: string; resourceId: string; resourceVersionId: string; question: string; positionMs: number; idempotencyKey: string }): Promise<void> {
  await insertStudyEvent(tx, { schemaVersion: 1, userId: input.userId, studySessionId: input.sessionId, resourceId: input.resourceId, resourceVersionId: input.resourceVersionId, eventType: "question.asked", actorType: "user", source: "web", correlationId: randomUUID(), idempotencyKey: `study:question:${input.sessionId}:${input.idempotencyKey}`, occurredAt: new Date(), payload: { question: input.question, anchor: { kind: "video", positionMs: input.positionMs } } });
}

export async function listStudySessions(userId: string): Promise<Array<{ id: string; title: string; status: SessionRow["status"]; mode: SessionRow["mode"]; lastActiveAt: string; resourceCount: number; progressPct: number; activeResource: { id: string; title: string; type: StudyType; youtubeId: string | null; readiness: StudyResourceReadiness } | null; route: string | null }>> {
  return withUserTransaction(userId, async (tx) => {
    const sessions = await tx.select().from(studySessions).where(and(eq(studySessions.userId, userId), ne(studySessions.status, "abandoned"))).orderBy(desc(studySessions.lastActiveAt)).limit(50);
    const ids = sessions.map((session) => session.id);
    if (ids.length === 0) return [];
    const activeRows = await tx
      .select({ sessionId: studySessions.id, resource: resources, video: videoDetails, paper: paperDetails, versionId: resourceVersions.id, versionStatus: resourceVersions.processingStatus })
      .from(studySessions)
      .leftJoin(sessionResources, and(eq(sessionResources.studySessionId, studySessions.id), eq(sessionResources.resourceId, studySessions.activeResourceId)))
      .leftJoin(resources, eq(resources.id, sessionResources.resourceId))
      .leftJoin(videoDetails, eq(videoDetails.resourceId, resources.id))
      .leftJoin(paperDetails, eq(paperDetails.resourceId, resources.id))
      .leftJoin(resourceVersions, eq(resourceVersions.id, sessionResources.resourceVersionId))
      .where(inArray(studySessions.id, ids));
    const countRows = await tx.select({ sessionId: sessionResources.studySessionId, count: count() }).from(sessionResources).where(inArray(sessionResources.studySessionId, ids)).groupBy(sessionResources.studySessionId);
    const progressIds = activeRows.flatMap((row) => row.resource?.id ? [row.resource.id] : []);
    const progressRows = progressIds.length > 0 ? await tx.select().from(userResourceProgress).where(and(eq(userResourceProgress.userId, userId), inArray(userResourceProgress.resourceId, progressIds))) : [];
    const progressByResource = new Map(progressRows.map((row) => [row.resourceId, row]));
    const countBySession = new Map(countRows.map((row) => [row.sessionId, Number(row.count)]));
    const activeBySession = new Map(activeRows.flatMap((row) => {
      if (!row.resource) return [];
      const resource = resourceFromRow({ resource: row.resource, video: row.video, paper: row.paper, versionId: row.versionId, versionStatus: row.versionStatus });
      const type = studyType(resource.type);
      return type ? [[row.sessionId, { id: resource.id, title: resource.title, type, youtubeId: resource.video?.youtubeId ?? null, readiness: resourceReadiness(resource, row.versionId) } as const]] : [];
    }));
    return sessions.map((session) => {
      const active = activeBySession.get(session.id) ?? null;
      const pct = active ? Number(progressByResource.get(active.id)?.progressPct ?? 0) : 0;
      return { id: session.id, title: session.title ?? active?.title ?? "Study session", status: session.status, mode: session.mode, lastActiveAt: iso(session.lastActiveAt) ?? new Date(0).toISOString(), resourceCount: countBySession.get(session.id) ?? 0, progressPct: pct, activeResource: active, route: active ? routeFor(active.type, session.id) : null };
    });
  });
}

export async function startCollection(userId: string, collectionId: string, idempotencyKey: string): Promise<StartStudySessionResponse> {
  const normalizedCollectionId = collectionIdSchema.parse(collectionId);
  const response = await withUserTransaction(userId, (tx) => startCollectionInTransaction(tx, userId, normalizedCollectionId, idempotencyKey));
  await invalidateHomeFeedCache(userId);
  return response;
}

async function startCollectionInTransaction(tx: Transaction, userId: string, normalizedCollectionId: string, idempotencyKey: string): Promise<StartStudySessionResponse> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.collection.start:${userId}:${normalizedCollectionId}`}, 0))`);
  const collectionRows = await tx
    .select()
    .from(collections)
    .where(and(eq(collections.id, normalizedCollectionId), or(eq(collections.ownerUserId, userId), eq(collections.visibility, "public"))))
    .limit(1);
  const collection = collectionRows[0];
  if (!collection) throw new AuthError("COLLECTION_NOT_FOUND", "That collection is not available.", 404);
  const current = await currentSessionInTransaction(tx, userId);
  const currentCourse = current ? courseOf(current) : null;
  // Continuing the course already in Sessions reopens it; anything else waits for that session to finish.
  if (current && currentCourse?.collectionId === normalizedCollectionId && current.activeResourceId) {
    const active = await loadResource(tx, userId, current.activeResourceId, true);
    if (active) return responseFor(current.id, active, resourceReadiness(active, current.activeVersionId), true);
  }
  if (current) throw sessionInProgress();
  const lessons = await loadCourseLessons(tx, normalizedCollectionId);
  if (lessons.length > 0) return createCourseSession(tx, userId, collection, lessons);
  // A collection with no videos (papers only) keeps the single-material session.
  const items = await tx
    .select({ item: collectionItems, sectionPosition: collectionSections.position, resource: resources })
    .from(collectionItems)
    .innerJoin(collectionSections, eq(collectionSections.id, collectionItems.sectionId))
    .innerJoin(resources, eq(resources.id, collectionItems.resourceId))
    .where(eq(collectionSections.collectionId, normalizedCollectionId))
    .orderBy(asc(collectionSections.position), asc(collectionItems.position));
  if (items.length === 0) throw new AuthError("EMPTY_COLLECTION", "This collection does not have any learning material yet.", 422);
  const enrollmentRows = await tx.select().from(collectionEnrollments).where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.collectionId, normalizedCollectionId))).limit(1);
  const currentId = enrollmentRows[0]?.currentItemId;
  const selected = items.find((row) => row.item.id === currentId) ?? items.find((row) => row.item.required) ?? items[0];
  if (!selected) throw new AuthError("EMPTY_COLLECTION", "This collection does not have any learning material yet.", 422);
  const type = studyType(selected.resource.type);
  if (!type) throw new AuthError("UNSUPPORTED_COLLECTION_ITEM", "This collection item does not have a study experience yet.", 422);
  const input: StartStudySessionRequest = { resourceId: selected.resource.id, origin: "collection", collectionId: normalizedCollectionId, collectionItemId: selected.item.id, idempotencyKey: `collection:${idempotencyKey}` };
  const result = await startOrResumeInTransaction(tx, userId, input);
  await tx.insert(collectionEnrollments).values({ userId, collectionId: normalizedCollectionId, currentItemId: selected.item.id, status: "active", progressPct: enrollmentRows[0]?.progressPct ?? 0 }).onConflictDoUpdate({ target: [collectionEnrollments.userId, collectionEnrollments.collectionId], set: { currentItemId: selected.item.id, status: "active", updatedAt: new Date() } });
  return result;
}

/** Finishing a lesson opens the next one in the same session; finishing the last one completes the session (and returns true). */
async function advanceSessionAfterCompletion(tx: Transaction, userId: string, session: SessionRow, completedResourceId: string): Promise<boolean> {
  const course = courseOf(session);
  let remaining: string[];
  if (course) {
    const lessons = await loadCourseLessons(tx, course.collectionId);
    const completed = await completedResourceIds(tx, userId, lessons.map((lesson) => lesson.resourceId));
    remaining = lessons.flatMap((lesson) => completed.has(lesson.resourceId) ? [] : [lesson.resourceId]);
  } else {
    const bindings = await tx.select({ resourceId: sessionResources.resourceId }).from(sessionResources).where(eq(sessionResources.studySessionId, session.id));
    const completed = await completedResourceIds(tx, userId, bindings.map((binding) => binding.resourceId));
    remaining = bindings.flatMap((binding) => completed.has(binding.resourceId) ? [] : [binding.resourceId]);
  }
  const next = course && remaining[0] ? await loadResource(tx, userId, remaining[0]) : null;
  if (next) {
    await activateResourceInTransaction(tx, userId, session.id, next, "primary", undefined, { origin: "collection", correlationId: randomUUID(), intent: "start", requestKey: `course-advance:${completedResourceId}` });
    return false;
  }
  if (remaining.length > 0) return false;
  const now = new Date();
  await tx.update(studySessions).set({ status: "completed", endedAt: now, lastActiveAt: now, updatedAt: now, lockVersion: sql`${studySessions.lockVersion} + 1` }).where(and(eq(studySessions.id, session.id), eq(studySessions.userId, userId)));
  // Every playable lesson is done, even if the course lists archived videos after them.
  if (course) await tx.update(collectionEnrollments).set({ status: "completed", progressPct: 100, completedAt: now, updatedAt: now }).where(and(eq(collectionEnrollments.userId, userId), eq(collectionEnrollments.collectionId, course.collectionId)));
  return true;
}

export async function findCurrentStudySession(userId: string): Promise<{ id: string } | null> {
  return withUserTransaction(userId, async (tx) => {
    const current = await currentSessionInTransaction(tx, userId);
    return current ? { id: current.id } : null;
  });
}

/** Whether a Discover course has lessons that can be studied, so its import button only shows when it will work. */
export async function isCourseImportable(slug: string, userId: string): Promise<boolean> {
  return withUserTransaction(userId, async (tx) => {
    const [course] = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.slug, slug), eq(collections.kind, "curated"), isNull(collections.ownerUserId))).limit(1);
    return course ? (await loadCourseLessons(tx, course.id)).length > 0 : false;
  });
}

/** Imports a whole Discover course as the learner's one session, starting at its first unfinished lesson. */
export async function importCourseToSessions(userId: string, slug: string): Promise<StartStudySessionResponse> {
  const response = await withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.course.import:${userId}`}, 0))`);
    if (await currentSessionInTransaction(tx, userId)) throw sessionInProgress();
    const [collection] = await tx.select().from(collections).where(and(eq(collections.slug, slug), eq(collections.kind, "curated"), isNull(collections.ownerUserId))).limit(1);
    if (!collection) throw new AuthError("COURSE_NOT_AVAILABLE", "This course cannot be imported yet.", 404);
    const lessons = await loadCourseLessons(tx, collection.id);
    if (lessons.length === 0) throw new AuthError("EMPTY_COLLECTION", "This course does not have any playable lessons yet.", 422);
    return createCourseSession(tx, userId, collection, lessons);
  });
  await invalidateHomeFeedCache(userId);
  return response;
}

/** One session holding every lesson of a course in order, opened at the first lesson the learner has not finished. */
async function createCourseSession(tx: Transaction, userId: string, collection: typeof collections.$inferSelect, lessons: CourseLesson[]): Promise<StartStudySessionResponse> {
  const completed = await completedResourceIds(tx, userId, lessons.map((lesson) => lesson.resourceId));
  const startIndex = lessons.findIndex((lesson) => !completed.has(lesson.resourceId));
  // Reopening a lesson would mark it unfinished again; finished courses are revisited from the Library instead.
  if (startIndex < 0) throw new AuthError("COURSE_COMPLETED", "You've finished this course. Rewatch its lessons from your Library.", 409);
  const records = await Promise.all(lessons.map((lesson) => loadResource(tx, userId, lesson.resourceId)));
  const [session] = await tx.insert(studySessions).values({
    userId,
    title: collection.title,
    mode: "guided_learning",
    status: "active",
    metadata: { startedFrom: "collection", course: { collectionId: collection.id, slug: collection.slug } },
  }).returning();
  if (!session) throw new Error("Study session could not be created");
  await tx.insert(sessionResources).values(records.flatMap((record, position) => {
    if (!record) return [];
    const ready = Boolean(record.versionId && record.versionStatus === "ready");
    return [{ studySessionId: session.id, resourceId: record.id, resourceVersionId: ready ? record.versionId : null, bindingStatus: ready ? "ready" : "preparing", role: "primary", position, addedBy: "user" }];
  }));
  const first = records[startIndex];
  const lesson = lessons[startIndex];
  if (!first || !lesson) throw new AuthError("RESOURCE_NOT_AVAILABLE", "This course's first lesson is not ready to study.", 404);
  const activated = await activateResourceInTransaction(tx, userId, session.id, first, "primary", undefined, { origin: "collection", correlationId: randomUUID(), intent: "start", requestKey: `course-start:${collection.id}` });
  await tx.insert(collectionEnrollments).values({ userId, collectionId: collection.id, currentItemId: lesson.itemId, status: "active", progressPct: (completed.size / lessons.length) * 100 })
    .onConflictDoUpdate({ target: [collectionEnrollments.userId, collectionEnrollments.collectionId], set: { currentItemId: lesson.itemId, status: "active", updatedAt: new Date() } });
  return responseFor(session.id, first, resourceReadiness(first, activated.resourceVersionId), false);
}

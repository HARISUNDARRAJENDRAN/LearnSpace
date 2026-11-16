import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  activityEvents,
  concepts,
  outboxEvents,
  userConceptAffinity,
  userSettings,
} from "@learnspace/db/schema";
import {
  ONBOARDING_FEATURE_VERSION,
  ONBOARDING_VERSION,
  onboardingCompletionSchema,
  onboardingDraftSchema,
  onboardingDraftRequestSchema,
  type OnboardingCompletion,
  type OnboardingDraft,
  type OnboardingDraftRequest,
} from "@learnspace/shared/onboarding";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";

const conceptSearchLimit = 40;
const onboardingAffinityScore = 0.25;
const onboardingAffinityConfidence = 0.2;
const onboardingAffinityPositiveWeight = 0.25;
const featuredConceptSlugs = [
  "ai-machine-learning",
  "data-science",
  "programming-computer-science",
  "web-development",
  "devops-cloud",
  "cybersecurity",
  "mathematics-statistics",
  "physics",
  "biology",
  "english-language-learning",
  "communication-public-speaking",
  "python",
  "transformers",
  "large-language-models",
  "react",
  "linear-algebra",
  "algorithms",
  "data-structures",
  "deep-learning",
  "computer-vision",
  "operating-systems",
] as const;
const featuredConceptRank = new Map<string, number>(
  featuredConceptSlugs.map((slug, index) => [slug, index]),
);

export type OnboardingConcept = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  summary: string | null;
};

export type OnboardingState = {
  completed: boolean;
  completedAt: string | null;
  version: number | null;
  draft: OnboardingDraft;
  selectedConcepts: OnboardingConcept[];
};

export class OnboardingError extends AuthError {
  constructor(code: string, message: string, status = 422) {
    super(code, message, status);
    this.name = "OnboardingError";
  }
}

function readDraft(value: unknown): OnboardingDraft {
  const result = onboardingDraftSchema.safeParse(value);
  return result.success ? result.data : {};
}

function readDraftRevision(value: unknown): number {
  return readDraft(value).draftRevision ?? 0;
}

async function loadSelectedConcepts(
  tx: Transaction,
  draft: OnboardingDraft,
): Promise<OnboardingConcept[]> {
  const conceptIds = draft.conceptIds ?? [];
  if (conceptIds.length === 0) {
    return [];
  }

  const rows = await tx
    .select({
      id: concepts.id,
      slug: concepts.slug,
      name: concepts.name,
      kind: concepts.kind,
      summary: concepts.summary,
    })
    .from(concepts)
    .where(inArray(concepts.id, conceptIds));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return conceptIds.flatMap((conceptId) => {
    const concept = byId.get(conceptId);
    return concept ? [concept] : [];
  });
}

async function stateFromSettings(
  tx: Transaction,
  settings: typeof userSettings.$inferSelect,
): Promise<OnboardingState> {
  const draft = readDraft(settings.learningPreferences);
  return {
    completed: settings.onboardingCompletedAt !== null,
    completedAt: settings.onboardingCompletedAt?.toISOString() ?? null,
    version: settings.onboardingVersion,
    draft,
    selectedConcepts: await loadSelectedConcepts(tx, draft),
  };
}

async function loadSettings(tx: Transaction, userId: string): Promise<typeof userSettings.$inferSelect> {
  const rows = await tx
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const settings = rows[0];
  if (!settings) {
    throw new OnboardingError(
      "ONBOARDING_SETTINGS_MISSING",
      "Your learning settings could not be loaded.",
      500,
    );
  }
  return settings;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

async function validateConcepts(
  tx: Transaction,
  conceptIds: string[],
): Promise<OnboardingConcept[]> {
  const uniqueIds = [...new Set(conceptIds)];
  const rows = await tx
    .select({
      id: concepts.id,
      slug: concepts.slug,
      name: concepts.name,
      kind: concepts.kind,
      summary: concepts.summary,
    })
    .from(concepts)
    .where(and(eq(concepts.status, "active"), inArray(concepts.id, uniqueIds)));

  if (rows.length !== uniqueIds.length || uniqueIds.length !== conceptIds.length) {
    throw new OnboardingError(
      "INVALID_CONCEPTS",
      "Choose interests from the LearnSpace catalog.",
    );
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return conceptIds.map((conceptId) => {
    const concept = byId.get(conceptId);
    if (!concept) {
      throw new OnboardingError(
        "INVALID_CONCEPTS",
        "Choose interests from the LearnSpace catalog.",
      );
    }
    return concept;
  });
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  return withUserTransaction(userId, async (tx) =>
    stateFromSettings(tx, await loadSettings(tx, userId)),
  );
}

export async function searchOnboardingConcepts(
  userId: string,
  query: string,
): Promise<OnboardingConcept[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const pattern = `%${escapeLike(normalizedQuery)}%`;
  const where = normalizedQuery
    ? and(
        eq(concepts.status, "active"),
        or(
          ilike(concepts.name, pattern),
          ilike(concepts.slug, pattern),
          sql`EXISTS (
            SELECT 1
            FROM knowledge.concept_aliases AS alias
            WHERE alias.concept_id = ${concepts.id}
              AND (alias.alias ILIKE ${pattern} OR alias.normalized_alias ILIKE ${pattern})
          )`,
        ),
      )
    : eq(concepts.status, "active");

  return withUserTransaction(userId, async (tx) => {
    const query = tx
      .select({
        id: concepts.id,
        slug: concepts.slug,
        name: concepts.name,
        kind: concepts.kind,
        summary: concepts.summary,
      })
      .from(concepts)
      .where(where);
    if (normalizedQuery) {
      return query.orderBy(asc(concepts.name)).limit(conceptSearchLimit);
    }

    const rows = await query.orderBy(asc(concepts.name));
    return rows
      .toSorted(
        (left, right) =>
          (featuredConceptRank.get(left.slug) ?? featuredConceptSlugs.length) -
            (featuredConceptRank.get(right.slug) ?? featuredConceptSlugs.length) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, conceptSearchLimit);
  });
}

export async function saveOnboardingDraft(
  userId: string,
  input: OnboardingDraftRequest,
): Promise<OnboardingState> {
  const draft = onboardingDraftRequestSchema.parse(input);

  return withUserTransaction(userId, async (tx) => {
    const settings = await loadSettings(tx, userId);
    const storedRevision = readDraftRevision(settings.learningPreferences);
    if (settings.onboardingCompletedAt || draft.draftRevision <= storedRevision) {
      return stateFromSettings(tx, settings);
    }

    const selectedConcepts = draft.conceptIds ? await validateConcepts(tx, draft.conceptIds) : [];

    const previousDraft = readDraft(settings.learningPreferences);
    const mergedDraft = onboardingDraftSchema.parse({
      ...previousDraft,
      ...draft,
      ...(draft.persona && draft.persona !== previousDraft.persona && draft.learningIntents === undefined
        ? { learningIntents: [] }
        : {}),
    });
    const now = new Date();
    const updatedRows = await tx
      .update(userSettings)
      .set({ learningPreferences: mergedDraft, updatedAt: now })
      .where(
        and(
          eq(userSettings.userId, userId),
          isNull(userSettings.onboardingCompletedAt),
          sql`COALESCE(NULLIF(${userSettings.learningPreferences}->>'draftRevision', '')::integer, 0) < ${draft.draftRevision}`,
        ),
      )
      .returning();

    // Discover the chosen topics while the learner finishes the last two steps. The worker skips
    // concepts refreshed recently, so the same request at completion costs nothing extra.
    const previousConceptIds = new Set(previousDraft.conceptIds ?? []);
    if (updatedRows[0] && selectedConcepts.length >= 3 && selectedConcepts.some(({ id }) => !previousConceptIds.has(id))) {
      await tx.insert(outboxEvents).values({
        aggregateType: "user",
        aggregateId: userId,
        eventType: "discovery.refresh_requested",
        schemaVersion: 1,
        userId,
        payload: {
          conceptIds: selectedConcepts.map(({ id }) => id),
          conceptNames: selectedConcepts.map(({ name }) => name),
          // Steps 1–2 are answered by now; the worker turns them into search lanes.
          persona: mergedDraft.persona ?? null,
          learningIntents: mergedDraft.learningIntents ?? [],
          preferredFormats: mergedDraft.preferredFormats ?? [],
          level: mergedDraft.selfReportedLevel ?? null,
          source: "onboarding-draft-v1",
          requestedAt: now.toISOString(),
        },
      });
    }
    return stateFromSettings(tx, updatedRows[0] ?? (await loadSettings(tx, userId)));
  });
}

export async function completeOnboarding(
  userId: string,
  input: OnboardingCompletion,
): Promise<OnboardingState> {
  const completion = onboardingCompletionSchema.parse(input);

  return withUserTransaction(userId, async (tx) => {
    const selectedConcepts = await validateConcepts(tx, completion.conceptIds);
    const now = new Date();
    const preferences = {
      persona: completion.persona,
      learningIntents: completion.learningIntents,
      preferredFormats: completion.preferredFormats,
      preferredDuration: completion.preferredDuration,
      selfReportedLevel: completion.selfReportedLevel,
      conceptIds: completion.conceptIds,
      ...(completion.preferredLanguages ? { preferredLanguages: completion.preferredLanguages } : {}),
    } satisfies Record<string, unknown>;
    const updatedRows = await tx
      .update(userSettings)
      .set({
        learningPreferences: preferences,
        onboardingCompletedAt: now,
        onboardingVersion: ONBOARDING_VERSION,
        updatedAt: now,
      })
      .where(
        and(
          eq(userSettings.userId, userId),
          isNull(userSettings.onboardingCompletedAt),
        ),
      )
      .returning();

    if (updatedRows.length === 0) {
      return stateFromSettings(tx, await loadSettings(tx, userId));
    }

    await tx
      .insert(userConceptAffinity)
      .values(
        selectedConcepts.map((concept) => ({
          userId,
          conceptId: concept.id,
          score: onboardingAffinityScore,
          confidence: onboardingAffinityConfidence,
          positiveWeight: onboardingAffinityPositiveWeight,
          negativeWeight: 0,
          featureVersion: ONBOARDING_FEATURE_VERSION,
          lastEventAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [userConceptAffinity.userId, userConceptAffinity.conceptId],
        set: {
          score: sql`LEAST(1.0, GREATEST(-1.0, ${userConceptAffinity.score} + ${onboardingAffinityScore} * (1.0 - ${userConceptAffinity.confidence})))`,
          confidence: sql`GREATEST(${userConceptAffinity.confidence}, ${onboardingAffinityConfidence})`,
          positiveWeight: sql`LEAST(1.0, ${userConceptAffinity.positiveWeight} + ${onboardingAffinityPositiveWeight})`,
          lastEventAt: now,
          updatedAt: now,
        },
        where: eq(userConceptAffinity.featureVersion, ONBOARDING_FEATURE_VERSION),
      });

    const [completionEvent] = await tx
      .insert(activityEvents)
      .values({
        schemaVersion: 1,
        userId,
        eventType: "onboarding.completed",
        actorType: "user",
        source: "web",
        idempotencyKey: "onboarding-v1",
        occurredAt: now,
        payload: {
          ...preferences,
          concepts: selectedConcepts.map(({ id, slug }) => ({ id, slug })),
        },
      })
      .onConflictDoNothing()
      .returning({ id: activityEvents.id });

    if (completionEvent) {
      await tx.insert(outboxEvents).values({
        aggregateType: "activity_event",
        aggregateId: completionEvent.id,
        eventType: "discovery.refresh_requested",
        schemaVersion: 1,
        userId,
        payload: {
          conceptIds: completion.conceptIds,
          conceptNames: selectedConcepts.map((concept) => concept.name),
          persona: completion.persona,
          learningIntents: completion.learningIntents,
          level: completion.selfReportedLevel,
          preferredFormats: completion.preferredFormats,
          source: "onboarding-v1",
          requestedAt: now.toISOString(),
        },
      });
    }

    const updatedSettings = updatedRows[0];
    if (!updatedSettings) {
      return stateFromSettings(tx, await loadSettings(tx, userId));
    }
    return stateFromSettings(tx, updatedSettings);
  });
}

export async function getAuthenticatedDestination(
  userId: string,
  requestedPath = "/app",
): Promise<string> {
  return withUserTransaction(userId, async (tx) => {
    const settings = await loadSettings(tx, userId);
    if (!settings.onboardingCompletedAt) return "/onboarding";
    if (!settings.firstApplicationVisitAt) return "/app/discover";
    return requestedPath === "/onboarding" ? "/app" : requestedPath;
  });
}

// Next.js strips Flight headers inside the proxy, but restores them for pages.
export function isApplicationPrefetch(headers: Pick<Headers, "get">): boolean {
  return headers.get("next-router-prefetch") !== null || headers.get("purpose") === "prefetch" || headers.get("sec-purpose")?.includes("prefetch") === true;
}

// The conditional update claims the entry once, including concurrent sessions. It answers whether
// that first entry should land on Discover: not when onboarding already planned a first session.
export async function recordFirstApplicationVisit(userId: string): Promise<boolean> {
  return withUserTransaction(userId, async (tx) => {
    const rows = await tx.execute(sql`
      WITH claim AS (
        SELECT user_id FROM identity.user_settings
        WHERE user_id = ${userId} AND onboarding_completed_at IS NOT NULL AND first_application_visit_at IS NULL
        FOR UPDATE SKIP LOCKED
      )
      UPDATE identity.user_settings settings
      SET first_application_visit_at = now(), updated_at = now()
      FROM claim WHERE settings.user_id = claim.user_id
      RETURNING NOT EXISTS (SELECT 1 FROM study.schedule_items WHERE user_id = ${userId}) AS land_on_discover
    `);
    return rows[0]?.land_on_discover === true;
  });
}

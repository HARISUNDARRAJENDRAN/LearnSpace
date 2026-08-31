import { withUserTransaction, type Transaction } from "@learnspace/db";
import {
  activityEvents,
  concepts,
  userConceptAffinity,
  userSettings,
} from "@learnspace/db/schema";
import {
  ONBOARDING_FEATURE_VERSION,
  ONBOARDING_VERSION,
  onboardingCompletionSchema,
  onboardingDraftSchema,
  type OnboardingCompletion,
  type OnboardingDraft,
} from "@learnspace/shared/onboarding";
import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";

const conceptSearchLimit = 40;

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

function stateFromSettings(settings: typeof userSettings.$inferSelect): OnboardingState {
  return {
    completed: settings.onboardingCompletedAt !== null,
    completedAt: settings.onboardingCompletedAt?.toISOString() ?? null,
    version: settings.onboardingVersion,
    draft: readDraft(settings.learningPreferences),
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
    stateFromSettings(await loadSettings(tx, userId)),
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

  return withUserTransaction(userId, async (tx) =>
    tx
      .select({
        id: concepts.id,
        slug: concepts.slug,
        name: concepts.name,
        kind: concepts.kind,
        summary: concepts.summary,
      })
      .from(concepts)
      .where(where)
      .orderBy(asc(concepts.name))
      .limit(conceptSearchLimit),
  );
}

export async function saveOnboardingDraft(
  userId: string,
  input: OnboardingDraft,
): Promise<OnboardingState> {
  const draft = onboardingDraftSchema.parse(input);

  return withUserTransaction(userId, async (tx) => {
    if (draft.conceptIds) {
      await validateConcepts(tx, draft.conceptIds);
    }

    const settings = await loadSettings(tx, userId);
    if (settings.onboardingCompletedAt) {
      return stateFromSettings(settings);
    }

    const mergedDraft = { ...readDraft(settings.learningPreferences), ...draft };
    const now = new Date();
    const updatedRows = await tx
      .update(userSettings)
      .set({ learningPreferences: mergedDraft, updatedAt: now })
      .where(
        and(
          eq(userSettings.userId, userId),
          isNull(userSettings.onboardingCompletedAt),
        ),
      )
      .returning();
    return stateFromSettings(updatedRows[0] ?? (await loadSettings(tx, userId)));
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
      return stateFromSettings(await loadSettings(tx, userId));
    }

    await tx
      .insert(userConceptAffinity)
      .values(
        selectedConcepts.map((concept) => ({
          userId,
          conceptId: concept.id,
          score: 0.25,
          confidence: 0.2,
          positiveWeight: 0.25,
          negativeWeight: 0,
          featureVersion: ONBOARDING_FEATURE_VERSION,
          lastEventAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [userConceptAffinity.userId, userConceptAffinity.conceptId],
        set: {
          featureVersion: ONBOARDING_FEATURE_VERSION,
          updatedAt: now,
        },
      });

    await tx
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
      .onConflictDoNothing();

    const updatedSettings = updatedRows[0];
    if (!updatedSettings) {
      return stateFromSettings(await loadSettings(tx, userId));
    }
    return stateFromSettings(updatedSettings);
  });
}

export async function getAuthenticatedDestination(
  userId: string,
  requestedPath = "/app",
): Promise<string> {
  const state = await getOnboardingState(userId);
  if (!state.completed) {
    return "/onboarding";
  }
  return requestedPath === "/onboarding" ? "/app" : requestedPath;
}

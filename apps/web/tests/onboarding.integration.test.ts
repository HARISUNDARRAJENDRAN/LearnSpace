import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import type { OnboardingCompletion } from "@learnspace/shared/onboarding";
import { hashPassword } from "../lib/auth/crypto";

const databaseAvailable = Boolean(
  process.env.DATABASE_URL &&
    process.env.DATABASE_AUTH_URL &&
    process.env.DATABASE_MIGRATOR_URL,
);

test(
  "onboarding completes atomically for canonical concepts and remains idempotent",
  { skip: databaseAvailable ? false : "DATABASE_URL, DATABASE_AUTH_URL, and DATABASE_MIGRATOR_URL are required" },
  async () => {
    const [{ withUserTransaction, closeDb }, { userSettings }, { createEmailUser }, { completeOnboarding, getOnboardingState, searchOnboardingConcepts, OnboardingError }] = await Promise.all([
      import("@learnspace/db"),
      import("@learnspace/db/schema"),
      import("../lib/auth/repository"),
      import("../lib/onboarding/service"),
    ]);
    const { saveOnboardingDraft } = await import("../lib/onboarding/service");
    const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
    if (!migratorUrl) {
      throw new Error("DATABASE_MIGRATOR_URL is required for onboarding integration tests");
    }
    const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
    const userIds: string[] = [];

    try {
      const expandedRows = await migrator<{ id: string; slug: string; name: string; kind: string }[]>`
        SELECT id, slug, name, kind
        FROM knowledge.concepts
        WHERE slug IN ('calculus', 'genetics', 'quantum-mechanics')
        ORDER BY slug
      `;
      assert.equal(expandedRows.length, 3);
      const expandedConceptIds = expandedRows.map((concept) => concept.id);
      const behaviorConceptId = expandedConceptIds[0];
      const onboardingConceptId = expandedConceptIds[1];
      assert.ok(behaviorConceptId);
      assert.ok(onboardingConceptId);
      const email = `onboarding-${randomUUID()}@example.test`;
      const otherEmail = `onboarding-other-${randomUUID()}@example.test`;
      const passwordHash = await hashPassword("onboarding-password-123");
      const user = await createEmailUser({ email, displayName: "Onboarding Learner", passwordHash });
      const otherUser = await createEmailUser({ email: otherEmail, displayName: "Other Learner", passwordHash });
      userIds.push(user.id, otherUser.id);

      assert.equal((await getOnboardingState(user.id)).completed, false);
      const defaultSearch = await searchOnboardingConcepts(user.id, "");
      assert.deepEqual(
        defaultSearch.slice(0, 21).map((concept) => concept.slug),
        [
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
        ],
      );
      const searchResults = await searchOnboardingConcepts(user.id, "LLM");
      assert.equal(searchResults.some((concept) => concept.slug === "large-language-models"), true);
      assert.equal((await searchOnboardingConcepts(user.id, "quantum")).some((concept) => concept.slug === "quantum-mechanics"), true);
      assert.equal((await searchOnboardingConcepts(user.id, "genetics")).some((concept) => concept.slug === "genetics"), true);
      assert.equal((await searchOnboardingConcepts(user.id, "calculus")).some((concept) => concept.slug === "calculus"), true);

      const firstDraft = await saveOnboardingDraft(user.id, {
        persona: "student",
        learningIntents: ["coursework"],
        preferredFormats: ["clear_explanations"],
        preferredDuration: "no_preference",
        selfReportedLevel: "beginner",
        conceptIds: [],
        draftRevision: 1,
      });
      assert.deepEqual(firstDraft.draft.learningIntents, ["coursework"]);
      assert.deepEqual(firstDraft.draft.preferredFormats, ["clear_explanations"]);

      const clearedDraft = await saveOnboardingDraft(user.id, {
        persona: "student",
        learningIntents: [],
        preferredFormats: [],
        preferredDuration: "no_preference",
        selfReportedLevel: "beginner",
        conceptIds: [],
        draftRevision: 2,
      });
      assert.deepEqual(clearedDraft.draft.learningIntents, []);
      assert.deepEqual(clearedDraft.draft.preferredFormats, []);

      await saveOnboardingDraft(user.id, {
        persona: "student",
        learningIntents: ["coursework"],
        preferredFormats: [],
        preferredDuration: "no_preference",
        selfReportedLevel: "beginner",
        conceptIds: [],
        draftRevision: 3,
      });
      const changedPersona = await saveOnboardingDraft(user.id, {
        persona: "professional",
        preferredFormats: [],
        preferredDuration: "no_preference",
        selfReportedLevel: "beginner",
        conceptIds: [],
        draftRevision: 4,
      });
      assert.equal(changedPersona.draft.persona, "professional");
      assert.deepEqual(changedPersona.draft.learningIntents, []);

      const staleDraft = await saveOnboardingDraft(user.id, {
        persona: "student",
        learningIntents: ["coursework"],
        preferredFormats: ["deep_dives"],
        preferredDuration: "no_preference",
        selfReportedLevel: "beginner",
        conceptIds: [],
        draftRevision: 3,
      });
      assert.equal(staleDraft.draft.draftRevision, 4);
      assert.equal(staleDraft.draft.persona, "professional");
      assert.deepEqual(staleDraft.draft.learningIntents, []);
      assert.deepEqual(staleDraft.draft.preferredFormats, []);

      await Promise.all([
        saveOnboardingDraft(user.id, {
          persona: "student",
          learningIntents: ["coursework"],
          preferredFormats: [],
          preferredDuration: "no_preference",
          selfReportedLevel: "beginner",
          conceptIds: [],
          draftRevision: 5,
        }),
        saveOnboardingDraft(user.id, {
          persona: "researcher",
          learningIntents: ["read_papers"],
          preferredFormats: [],
          preferredDuration: "no_preference",
          selfReportedLevel: "beginner",
          conceptIds: [],
          draftRevision: 6,
        }),
      ]);
      const latestDraft = await getOnboardingState(user.id);
      assert.equal(latestDraft.draft.draftRevision, 6);
      assert.equal(latestDraft.draft.persona, "researcher");
      assert.deepEqual(latestDraft.draft.learningIntents, ["read_papers"]);

      await migrator`
        INSERT INTO discovery.user_concept_affinity
          (user_id, concept_id, score, confidence, positive_weight, negative_weight, feature_version, last_event_at)
        VALUES
          (${user.id}, ${behaviorConceptId}, 0.8, 0.9, 0.7, 0.3, 'behavior-v1', now()),
          (${user.id}, ${onboardingConceptId}, 0.4, 0.1, 0.6, 0.1, 'onboarding-v1', now())
      `;

      const completion: OnboardingCompletion = {
        persona: "student",
        learningIntents: ["coursework", "research"],
        preferredFormats: ["clear_explanations", "learn_by_building"],
        preferredDuration: "ten_to_thirty_minutes",
        selfReportedLevel: "beginner",
        conceptIds: expandedConceptIds,
      };
      const invalidCompletion: OnboardingCompletion = {
        ...completion,
        conceptIds: [
          expandedConceptIds[0] ?? "00000000-0000-4000-8000-000000000999",
          expandedConceptIds[1] ?? "00000000-0000-4000-8000-000000000998",
          "00000000-0000-4000-8000-000000000997",
        ],
      };
      await assert.rejects(
        () => completeOnboarding(user.id, invalidCompletion),
        (error: unknown) => error instanceof OnboardingError && error.code === "INVALID_CONCEPTS",
      );

      const completed = await completeOnboarding(user.id, completion);
      assert.equal(completed.completed, true);
      assert.equal(completed.version, 1);
      assert.deepEqual(completed.draft.conceptIds, expandedConceptIds);
      assert.deepEqual(
        completed.selectedConcepts.map((concept) => ({ name: concept.name, slug: concept.slug, kind: concept.kind })),
        expandedRows.map(({ name, slug, kind }) => ({ name, slug, kind })),
      );

      const settingsRows = await migrator<{ onboarding_version: number; learning_preferences: Record<string, unknown> }[]>`
        SELECT onboarding_version, learning_preferences
        FROM identity.user_settings
        WHERE user_id = ${user.id}
      `;
      assert.equal(settingsRows[0]?.onboarding_version, 1);
      assert.deepEqual(settingsRows[0]?.learning_preferences.conceptIds, expandedConceptIds);
      assert.equal(settingsRows[0]?.learning_preferences.persona, "student");

      const affinityRows = await migrator<{ concept_id: string; feature_version: string; score: number; confidence: number; positive_weight: number; negative_weight: number }[]>`
        SELECT concept_id, feature_version, score, confidence, positive_weight, negative_weight
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id}
        ORDER BY concept_id
      `;
      assert.equal(affinityRows.length, 3);
      const preservedBehavior = affinityRows.find((row) => row.concept_id === behaviorConceptId);
      assert.deepEqual(preservedBehavior, {
        concept_id: behaviorConceptId,
        feature_version: "behavior-v1",
        score: 0.8,
        confidence: 0.9,
        positive_weight: 0.7,
        negative_weight: 0.3,
      });
      const refreshedOnboarding = affinityRows.find((row) => row.concept_id === onboardingConceptId);
      assert.ok(refreshedOnboarding);
      assert.equal(refreshedOnboarding.feature_version, "onboarding-v1");
      assert.ok(Math.abs(refreshedOnboarding.score - (0.4 + 0.25 * (1 - 0.1))) < 0.001);
      assert.equal(refreshedOnboarding.confidence, Math.max(0.1, 0.2));
      assert.ok(Math.abs(refreshedOnboarding.positive_weight - Math.min(1, 0.6 + 0.25)) < 0.001);
      assert.equal(refreshedOnboarding.negative_weight, 0.1);
      const coldStartAffinity = affinityRows.find(
        (row) => row.concept_id !== behaviorConceptId && row.concept_id !== onboardingConceptId,
      );
      assert.deepEqual(coldStartAffinity, {
        concept_id: expandedConceptIds[2],
        feature_version: "onboarding-v1",
        score: 0.25,
        confidence: 0.2,
        positive_weight: 0.25,
        negative_weight: 0,
      });

      const eventRows = await migrator<{ event_type: string; idempotency_key: string; payload: Record<string, unknown> }[]>`
        SELECT event_type, idempotency_key, payload
        FROM activity.activity_events
        WHERE user_id = ${user.id} AND event_type = 'onboarding.completed'
      `;
      assert.equal(eventRows.length, 1);
      assert.equal(eventRows[0]?.idempotency_key, "onboarding-v1");
      assert.deepEqual(eventRows[0]?.payload.conceptIds, expandedConceptIds);

      const duplicate = await completeOnboarding(user.id, completion);
      assert.equal(duplicate.completed, true);
      const duplicateEvents = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM activity.activity_events
        WHERE user_id = ${user.id} AND event_type = 'onboarding.completed'
      `;
      assert.equal(Number(duplicateEvents[0]?.count), 1);

      await withUserTransaction(user.id, async (tx) => {
        const rows = await tx
          .update(userSettings)
          .set({ onboardingVersion: 99 })
          .where(eq(userSettings.userId, otherUser.id))
          .returning({ userId: userSettings.userId });
        assert.equal(rows.length, 0);
      });
      assert.equal((await getOnboardingState(otherUser.id)).completed, false);
    } finally {
      try {
        for (const userId of userIds) {
          await migrator`DELETE FROM ops.outbox_events WHERE user_id = ${userId}`;
          await migrator`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
          await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
        }
      } finally {
        await migrator.end({ timeout: 5 });
        await closeDb();
      }
    }
  },
);

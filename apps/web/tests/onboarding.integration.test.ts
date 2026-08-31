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
    const [{ withUserTransaction }, { userSettings }, { createEmailUser }, { completeOnboarding, getOnboardingState, searchOnboardingConcepts, OnboardingError }] = await Promise.all([
      import("@learnspace/db"),
      import("@learnspace/db/schema"),
      import("../lib/auth/repository"),
      import("../lib/onboarding/service"),
    ]);
    const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
    if (!migratorUrl) {
      throw new Error("DATABASE_MIGRATOR_URL is required for onboarding integration tests");
    }
    const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
    const userIds: string[] = [];

    try {
      const conceptRows = await migrator<{ id: string; slug: string }[]>`
        SELECT id, slug
        FROM knowledge.concepts
        WHERE slug IN ('python', 'react', 'large-language-models')
        ORDER BY slug
      `;
      assert.equal(conceptRows.length, 3);
      const conceptIds = conceptRows.map((concept) => concept.id);
      const email = `onboarding-${randomUUID()}@example.test`;
      const otherEmail = `onboarding-other-${randomUUID()}@example.test`;
      const passwordHash = await hashPassword("onboarding-password-123");
      const user = await createEmailUser({ email, displayName: "Onboarding Learner", passwordHash });
      const otherUser = await createEmailUser({ email: otherEmail, displayName: "Other Learner", passwordHash });
      userIds.push(user.id, otherUser.id);

      assert.equal((await getOnboardingState(user.id)).completed, false);
      const searchResults = await searchOnboardingConcepts(user.id, "LLM");
      assert.equal(searchResults.some((concept) => concept.slug === "large-language-models"), true);

      const completion: OnboardingCompletion = {
        persona: "student",
        learningIntents: ["coursework", "research"],
        preferredFormats: ["clear_explanations", "learn_by_building"],
        preferredDuration: "ten_to_thirty_minutes",
        selfReportedLevel: "beginner",
        conceptIds,
      };
      const invalidCompletion: OnboardingCompletion = {
        ...completion,
        conceptIds: [
          conceptIds[0] ?? "00000000-0000-4000-8000-000000000999",
          conceptIds[1] ?? "00000000-0000-4000-8000-000000000998",
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
      assert.deepEqual(completed.draft.conceptIds, conceptIds);

      const settingsRows = await migrator<{ onboarding_version: number; learning_preferences: Record<string, unknown> }[]>`
        SELECT onboarding_version, learning_preferences
        FROM identity.user_settings
        WHERE user_id = ${user.id}
      `;
      assert.equal(settingsRows[0]?.onboarding_version, 1);
      assert.deepEqual(settingsRows[0]?.learning_preferences.conceptIds, conceptIds);
      assert.equal(settingsRows[0]?.learning_preferences.persona, "student");

      const affinityRows = await migrator<{ concept_id: string; feature_version: string; score: number; confidence: number }[]>`
        SELECT concept_id, feature_version, score, confidence
        FROM discovery.user_concept_affinity
        WHERE user_id = ${user.id}
        ORDER BY concept_id
      `;
      assert.equal(affinityRows.length, 3);
      assert.equal(affinityRows.every((row) => row.feature_version === "onboarding-v1" && row.score === 0.25 && row.confidence === 0.2), true);

      const eventRows = await migrator<{ event_type: string; idempotency_key: string; payload: Record<string, unknown> }[]>`
        SELECT event_type, idempotency_key, payload
        FROM activity.activity_events
        WHERE user_id = ${user.id} AND event_type = 'onboarding.completed'
      `;
      assert.equal(eventRows.length, 1);
      assert.equal(eventRows[0]?.idempotency_key, "onboarding-v1");
      assert.deepEqual(eventRows[0]?.payload.conceptIds, conceptIds);

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
      for (const userId of userIds) {
        await migrator`DELETE FROM activity.activity_events WHERE user_id = ${userId}`;
        await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
      }
      await migrator.end({ timeout: 5 });
    }
  },
);

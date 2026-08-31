import { strict as assert } from "node:assert";
import { activityEventContract, subscriptionTierSchema } from "./contracts.js";
import {
  STARTING_LEVEL_OPTIONS,
  onboardingCompletionSchema,
  onboardingDraftSchema,
} from "./onboarding.js";

assert.equal(subscriptionTierSchema.parse("free"), "free");
assert.equal(
  activityEventContract.parse({
    schemaVersion: 1,
    userId: "00000000-0000-4000-8000-000000000001",
    eventType: "resource.opened",
    actorType: "user",
    source: "web",
    occurredAt: new Date().toISOString(),
  }).eventType,
  "resource.opened",
);
assert.equal(
  activityEventContract.parse({
    schemaVersion: 1,
    userId: "00000000-0000-4000-8000-000000000001",
    eventType: "onboarding.completed",
    actorType: "user",
    source: "web",
    occurredAt: new Date().toISOString(),
  }).eventType,
  "onboarding.completed",
);
const draft = onboardingDraftSchema.parse({
  draftRevision: 1,
  persona: "student",
  learningIntents: [],
  preferredFormats: [],
  conceptIds: [],
});
assert.deepEqual(draft.learningIntents, []);
assert.deepEqual(draft.preferredFormats, []);
assert.equal(
  onboardingCompletionSchema.safeParse({
    persona: "student",
    learningIntents: [],
    preferredFormats: [],
    preferredDuration: "no_preference",
    selfReportedLevel: "beginner",
    conceptIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ],
  }).success,
  false,
);
assert.deepEqual(
  STARTING_LEVEL_OPTIONS.map((option) => option.label),
  [
    "Just getting started",
    "I know the basics",
    "I'm fairly comfortable",
    "I'm advanced",
    "It depends on the topic",
  ],
);
assert.deepEqual(
  STARTING_LEVEL_OPTIONS.map((option) => option.value),
  ["beginner", "intermediate", "intermediate", "advanced", "mixed"],
);
console.log("shared contract checks passed");

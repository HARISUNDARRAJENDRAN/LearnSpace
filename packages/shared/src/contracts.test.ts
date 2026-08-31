import { strict as assert } from "node:assert";
import { activityEventContract, subscriptionTierSchema } from "./contracts.js";

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
console.log("shared contract checks passed");

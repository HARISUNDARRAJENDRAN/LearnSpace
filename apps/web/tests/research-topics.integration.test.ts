import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { AuthError } from "../lib/auth/errors";

const databaseAvailable = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL);

test("Research topics replace the onboarding interests, stay private, and accept only catalogue concepts", { skip: databaseAvailable ? false : "database URLs are required" }, async () => {
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const [{ closeDb, withUserTransaction }, { createEmailUser }, { researchTopicIds, setResearchTopics }] = await Promise.all([
    import("@learnspace/db"),
    import("../lib/auth/repository"),
    import("../lib/research/service"),
  ]);
  const reader = await createEmailUser({ email: `topics-${randomUUID()}@example.test`, displayName: "Topic Reader", passwordHash: "test-hash" });
  const other = await createEmailUser({ email: `topics-other-${randomUUID()}@example.test`, displayName: "Other Reader", passwordHash: "test-hash" });
  try {
    const rows = await migrator<{ id: string }[]>`SELECT id FROM knowledge.concepts WHERE status = 'active' ORDER BY slug LIMIT 2`;
    const [first, second] = rows.map(({ id }) => id);
    assert.ok(first && second, "the catalogue has active concepts");
    await migrator`UPDATE identity.user_settings SET learning_preferences = ${migrator.json({ conceptIds: [first] })} WHERE user_id = ${reader.id}`;
    assert.deepEqual(await withUserTransaction(reader.id, (tx) => researchTopicIds(tx, reader.id)), [first], "onboarding interests are the default");

    const saved = await setResearchTopics(reader.id, [second, first]);
    assert.deepEqual(saved.topics.map(({ id }) => id), [second, first]);
    assert.deepEqual(await withUserTransaction(reader.id, (tx) => researchTopicIds(tx, reader.id)), [second, first], "chosen topics replace them, in order");
    assert.deepEqual(await withUserTransaction(other.id, (tx) => researchTopicIds(tx, reader.id)), [], "another reader cannot see them");

    await assert.rejects(setResearchTopics(reader.id, [randomUUID()]), (error) => error instanceof AuthError && error.status === 400);
    assert.deepEqual(await withUserTransaction(reader.id, (tx) => researchTopicIds(tx, reader.id)), [second, first], "a rejected save changes nothing");
  } finally {
    await migrator`DELETE FROM identity.users WHERE id IN (${reader.id}, ${other.id})`;
    await migrator.end();
    await closeDb();
  }
});

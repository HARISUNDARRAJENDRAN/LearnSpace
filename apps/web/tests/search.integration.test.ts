import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL);

test("workspace search isolates Learn and Research resources and sessions", { skip: databaseAvailable ? false : "DATABASE_URL, DATABASE_AUTH_URL, and DATABASE_MIGRATOR_URL are required" }, async () => {
  const [{ closeDb }, { createEmailUser }, { searchWorkspace }] = await Promise.all([
    import("@learnspace/db"),
    import("../lib/auth/repository"),
    import("../lib/search/service"),
  ]);
  const databaseUrl = process.env.DATABASE_MIGRATOR_URL;
  if (!databaseUrl) throw new Error("DATABASE_MIGRATOR_URL is required for search integration tests");
  const database = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const user = await createEmailUser({ email: `search-${randomUUID()}@example.test`, displayName: "Search Test", passwordHash: "test-hash" });
  const videoId = randomUUID();
  const paperId = randomUUID();
  const learnSessionId = randomUUID();
  const researchSessionId = randomUUID();
  const authorId = randomUUID();
  const topicId = randomUUID();
  const term = `modeisolation${randomUUID().replaceAll("-", "")}`;

  try {
    await database.begin(async (tx) => {
      const videoUrl = `https://www.youtube.com/watch?v=${randomUUID().replaceAll("-", "").slice(0, 11)}`;
      await tx`INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status, metadata)
        VALUES (${videoId}, ${user.id}, 'video', 'youtube', ${`search-video-${videoId}`}, ${videoUrl}, ${`${term} video`}, 'Search isolation fixture', 'private', 'ready', '{}'::jsonb)`;
      await tx`INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status, metadata)
        VALUES (${paperId}, ${user.id}, 'paper', 'arxiv', ${`search-paper-${paperId}`}, ${`https://arxiv.org/abs/9999.${paperId.slice(0, 5)}`}, ${`${term} paper`}, 'Search isolation fixture', 'private', 'ready', '{}'::jsonb)`;
      await tx`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract) VALUES (${paperId}, ${`9999.${paperId.slice(0, 5)}`}, ${`Abstract ${term}`})`;
      await tx`INSERT INTO catalog.authors (id, normalized_name, preferred_name) VALUES (${authorId}, ${`${term} author`}, ${`${term} Author`})`;
      await tx`INSERT INTO catalog.paper_authors (paper_resource_id, author_id, ordinal) VALUES (${paperId}, ${authorId}, 0)`;
      await tx`INSERT INTO knowledge.concepts (id, slug, name, kind, status) VALUES (${topicId}, ${`search-${topicId}`}, ${`${term} research topic`}, 'topic', 'active')`;
      await tx`INSERT INTO discovery.research_topics (user_id, concept_id) VALUES (${user.id}, ${topicId})`;
      await tx`INSERT INTO study.study_sessions (id, user_id, title, mode, status, active_resource_id) VALUES
        (${learnSessionId}, ${user.id}, ${`${term} Learn session`}, 'guided_learning', 'active', ${videoId}),
        (${researchSessionId}, ${user.id}, ${`${term} Research session`}, 'research', 'active', ${paperId})`;
    });

    const [learn, research] = await Promise.all([
      searchWorkspace(user.id, term, "learn"),
      searchWorkspace(user.id, term, "research"),
    ]);
    assert.ok(learn.some((result) => result.id === videoId && result.resourceType === "video"));
    assert.ok(learn.some((result) => result.id === learnSessionId && result.kind === "session"));
    assert.ok(!learn.some((result) => result.id === paperId || result.id === researchSessionId || result.id === topicId || result.resourceType === "paper"));
    assert.ok(research.some((result) => result.id === paperId && result.resourceType === "paper"));
    assert.ok(research.some((result) => result.id === researchSessionId && result.kind === "session"));
    assert.ok(research.some((result) => result.id === authorId && result.kind === "author" && result.href === `/app/research/authors/${authorId}`));
    assert.ok(research.some((result) => result.id === topicId && result.kind === "concept"));
    assert.ok(!research.some((result) => result.id === videoId || result.id === learnSessionId || result.resourceType === "video"));
  } finally {
    await database`DELETE FROM catalog.paper_authors WHERE paper_resource_id = ${paperId}`;
    await database`DELETE FROM catalog.authors WHERE id = ${authorId}`;
    await database`DELETE FROM catalog.paper_details WHERE resource_id = ${paperId}`;
    await database`DELETE FROM discovery.research_topics WHERE user_id = ${user.id}`;
    await database`DELETE FROM knowledge.concepts WHERE id = ${topicId}`;
    await database`DELETE FROM study.study_sessions WHERE id IN (${learnSessionId}, ${researchSessionId})`;
    await database`DELETE FROM catalog.resources WHERE id IN (${videoId}, ${paperId})`;
    await database`DELETE FROM identity.users WHERE id = ${user.id}`;
    await database.end({ timeout: 5 });
    await closeDb();
  }
});

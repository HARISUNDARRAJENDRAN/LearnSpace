import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL);

test(
  "Learn Home reads scoped continuation and related videos",
  { skip: databaseAvailable ? false : "DATABASE_URL, DATABASE_AUTH_URL, and DATABASE_MIGRATOR_URL are required" },
  async () => {
    const [{ closeDb }, { createEmailUser }, { getLearnHome }] = await Promise.all([
      import("@learnspace/db"),
      import("../lib/auth/repository"),
      import("../lib/home/service"),
    ]);
    const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
    if (!migratorUrl) throw new Error("DATABASE_MIGRATOR_URL is required for Home integration tests");
    const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
    const owner = await createEmailUser({ email: `home-owner-${randomUUID()}@example.test`, displayName: "Home Owner", passwordHash: "test-hash" });
    const pausedLearner = await createEmailUser({ email: `home-paused-${randomUUID()}@example.test`, displayName: "Paused Learner", passwordHash: "test-hash" });
    const otherLearner = await createEmailUser({ email: `home-other-${randomUUID()}@example.test`, displayName: "Other Learner", passwordHash: "test-hash" });
    const userIds = [owner.id, pausedLearner.id, otherLearner.id];
    const resourceIds = {
      anchor: randomUUID(),
      olderSession: randomUUID(),
      relatedHigh: randomUUID(),
      relatedLow: randomUUID(),
      dismissed: randomUUID(),
      unrelated: randomUUID(),
      completed: randomUUID(),
      paper: randomUUID(),
      paused: randomUUID(),
      other: randomUUID(),
    };
    const sessionIds = {
      anchor: randomUUID(),
      older: randomUUID(),
      paused: randomUUID(),
      other: randomUUID(),
    };
    const now = new Date();
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    const youtubeIds = new Map(Object.keys(resourceIds).filter((key) => key !== "paper").map((key) => [key, randomUUID().replaceAll("-", "").slice(0, 11)]));
    const videoDefinitions = [
      [resourceIds.anchor, "Building AI Agents", "LearnSpace Main", "anchor"],
      [resourceIds.olderSession, "Older continuation", "LearnSpace Main", "olderSession"],
      [resourceIds.relatedHigh, "Advanced agent patterns", "High Quality Lab", "relatedHigh"],
      [resourceIds.relatedLow, "Agent patterns overview", "Low Quality Lab", "relatedLow"],
      [resourceIds.dismissed, "Dismissed agent lesson", "Dismissed Lab", "dismissed"],
      [resourceIds.unrelated, "Cooking basics", "Unrelated Lab", "unrelated"],
      [resourceIds.completed, "Neural networks from scratch", "History Lab", "completed"],
      [resourceIds.paused, "Paused video lesson", "Paused Lab", "paused"],
      [resourceIds.other, "Other learner lesson", "Other Lab", "other"],
    ] as const;

    try {
      const concepts = await migrator<{ id: string; name: string }[]>`
        SELECT id, name FROM knowledge.concepts
        WHERE slug = 'ai-machine-learning' AND status = 'active'
        LIMIT 1
      `;
      const concept = concepts[0];
      if (!concept) throw new Error("AI concept is required for Home integration tests");

      await migrator.begin(async (tx) => {
        for (const [resourceId, title, channelTitle, key] of videoDefinitions) {
          const youtubeId = youtubeIds.get(key);
          if (!youtubeId) throw new Error(`Missing YouTube ID for ${key}`);
          const qualityScore = key === "relatedHigh" ? 0.98 : key === "relatedLow" ? 0.2 : 0.8;
          await tx`
            INSERT INTO catalog.resources
              (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
            VALUES
              (${resourceId}, 'video', 'youtube', ${`home-${key}-${resourceId}`}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${title}, 'A deterministic Home integration video.', 'public', 'ready', ${qualityScore}, '{}'::jsonb)
          `;
          await tx`
            INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
            VALUES (${resourceId}, ${youtubeId}, ${channelTitle}, 600000, now())
          `;
        }
        await tx`
          INSERT INTO catalog.resources
            (id, type, provider, external_id, canonical_url, title, description, visibility, status, quality_score, metadata)
          VALUES
            (${resourceIds.paper}, 'paper', 'arxiv', ${`home-paper-${resourceIds.paper}`}, 'https://arxiv.org/abs/1.00001', 'A paper that must stay out of Learn Home', 'A deterministic paper.', 'public', 'ready', 0.99, '{}'::jsonb)
        `;
        for (const resourceId of [resourceIds.anchor, resourceIds.relatedHigh, resourceIds.relatedLow, resourceIds.dismissed]) {
          await tx`
            INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
            VALUES (${resourceId}, ${concept.id}, 'home-integration', 1, true)
          `;
        }

        const sessions = [
          [sessionIds.anchor, owner.id, resourceIds.anchor, "active", ago(30)],
          [sessionIds.older, owner.id, resourceIds.olderSession, "active", ago(120)],
          [sessionIds.paused, pausedLearner.id, resourceIds.paused, "paused", ago(45)],
          [sessionIds.other, otherLearner.id, resourceIds.other, "active", ago(20)],
        ] as const;
        for (const [sessionId, userId, resourceId, status, lastActiveAt] of sessions) {
          await tx`
            INSERT INTO study.study_sessions
              (id, user_id, title, mode, status, active_resource_id, started_at, last_active_at, metadata)
            VALUES
              (${sessionId}, ${userId}, 'Home integration session', 'guided_learning', ${status}, ${resourceId}, ${ago(300)}, ${lastActiveAt}, '{}'::jsonb)
          `;
          await tx`
            INSERT INTO study.session_resources
              (study_session_id, resource_id, binding_status, role, position, added_by)
            VALUES
              (${sessionId}, ${resourceId}, 'preparing', 'primary', 0, 'user')
          `;
        }

        const progressRows = [
          [owner.id, resourceIds.anchor, sessionIds.anchor, "active", 64, ago(32), null],
          [owner.id, resourceIds.olderSession, sessionIds.older, "active", 12, ago(120), null],
          [owner.id, resourceIds.completed, null, "completed", 100, ago(1_440), ago(1_440)],
          [owner.id, resourceIds.paper, null, "active", 40, ago(10), null],
          [pausedLearner.id, resourceIds.paused, sessionIds.paused, "active", 48, ago(45), null],
          [otherLearner.id, resourceIds.other, sessionIds.other, "active", 31, ago(20), null],
        ] as const;
        for (const [userId, resourceId, lastSessionId, status, progressPct, lastOpenedAt, completedAt] of progressRows) {
          await tx`
            INSERT INTO study.user_resource_progress
              (user_id, resource_id, last_session_id, status, progress_pct, last_anchor, first_started_at, last_opened_at, completed_at, updated_at)
            VALUES
              (${userId}, ${resourceId}, ${lastSessionId}, ${status}, ${progressPct}, ${JSON.stringify({ kind: "video", positionMs: progressPct * 1000 })}::jsonb, ${ago(500)}, ${lastOpenedAt}, ${completedAt}, ${lastOpenedAt})
          `;
        }
        await tx`
          INSERT INTO catalog.library_items (user_id, resource_id, status, source)
          VALUES (${owner.id}, ${resourceIds.dismissed}, 'removed', 'discovery')
        `;
      });

      const home = await getLearnHome(owner.id);
      assert.equal(home.continueWatching?.resourceId, resourceIds.anchor);
      assert.equal(home.continueWatching?.sessionId, sessionIds.anchor);
      assert.equal(home.continueWatching?.progressPct, 64);
      assert.equal(home.continueWatching?.description, "A deterministic Home integration video.");
      assert.equal(home.relatedAnchor?.resourceId, resourceIds.anchor);
      assert.equal(home.relatedVideos[0]?.resourceId, resourceIds.relatedHigh);
      assert.equal(home.relatedVideos.some((item) => item.resourceId === resourceIds.anchor), false);
      assert.equal(home.relatedVideos.some((item) => item.resourceId === resourceIds.dismissed), false);
      assert.equal(home.relatedVideos.some((item) => item.resourceId === resourceIds.paper), false);
      assert.equal(new Set(home.relatedVideos.map((item) => item.resourceId)).size, home.relatedVideos.length);

      const pausedHome = await getLearnHome(pausedLearner.id);
      assert.equal(pausedHome.continueWatching?.resourceId, resourceIds.paused);
      assert.equal(pausedHome.continueWatching?.progressPct, 48);

      const otherHome = await getLearnHome(otherLearner.id);
      assert.equal(otherHome.continueWatching?.resourceId, resourceIds.other);
    } finally {
      await migrator`DELETE FROM study.user_resource_progress WHERE user_id IN ${migrator(userIds)}`;
      await migrator`DELETE FROM study.session_resources WHERE study_session_id IN ${migrator(Object.values(sessionIds))}`;
      await migrator`DELETE FROM study.study_sessions WHERE id IN ${migrator(Object.values(sessionIds))}`;
      await migrator`DELETE FROM catalog.library_items WHERE user_id IN ${migrator(userIds)} OR resource_id IN ${migrator(Object.values(resourceIds))}`;
      await migrator`DELETE FROM catalog.resource_concepts WHERE resource_id IN ${migrator(Object.values(resourceIds))}`;
      await migrator`DELETE FROM catalog.video_details WHERE resource_id IN ${migrator(Object.values(resourceIds))}`;
      await migrator`DELETE FROM catalog.resources WHERE id IN ${migrator(Object.values(resourceIds))}`;
      await migrator`DELETE FROM identity.users WHERE id IN ${migrator(userIds)}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

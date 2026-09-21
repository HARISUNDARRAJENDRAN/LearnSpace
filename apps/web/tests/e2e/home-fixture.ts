import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { createSession } from "../../lib/auth/repository";
import { invalidateHomeFeedCache } from "../../lib/discovery/cache";

type Database = ReturnType<typeof postgres>;

export type HomeFixture = {
  userId: string;
  email: string;
  sessionToken: string;
  resources: { hero: string; olderVideo: string; paper: string; recommendations: string[] };
  sessions: { hero: string; olderVideo: string; paper: string };
};

const youtubeIds = ["_uQrJ0TkZlc", "dQw4w9WgXcQ", "9bZkp7q19f0", "M7lc1UVf-VE", "aqz-KE-bpKQ", "ysz5S6PUM-U", "ScMzIvxBSi4"] as const;

function youtubeIdAt(index: number): string {
  const id = youtubeIds[index];
  if (!id) throw new Error(`Missing deterministic YouTube fixture at ${index}`);
  return id;
}

export async function seedHomeFixture(database: Database): Promise<HomeFixture> {
  const userId = randomUUID();
  const email = `home-populated-${userId}@example.test`;
  const hero = randomUUID();
  const olderVideo = randomUUID();
  const paper = randomUUID();
  const recommendations = Array.from({ length: 5 }, () => randomUUID());
  const heroSession = randomUUID();
  const olderSession = randomUUID();
  const paperSession = randomUUID();
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000);
  const conceptRows = await database<{ id: string }[]>`
    SELECT id FROM knowledge.concepts WHERE slug = 'ai-machine-learning' AND status = 'active' LIMIT 1
  `;
  const concept = conceptRows[0];
  if (!concept) throw new Error("AI concept is required for Home E2E");

  await database.begin(async (tx) => {
    await tx`
      INSERT INTO identity.users (id, email, email_verified, status, display_name, locale, timezone, subscription_tier)
      VALUES (${userId}, ${email}, true, 'active', 'Home Visual Learner', 'en', 'UTC', 'free')
    `;
    await tx`
      INSERT INTO identity.user_settings (user_id, onboarding_completed_at, onboarding_version, learning_preferences)
      VALUES (${userId}, now(), 1, ${JSON.stringify({ conceptIds: [concept.id], selfReportedLevel: "intermediate", preferredFormats: ["clear_explanations"] })}::jsonb)
    `;
    const videoRows = [
      [hero, "Home E2E Python lesson", "LearnSpace Home Lab", youtubeIdAt(0), 0.99],
      [olderVideo, "Home E2E history lesson", "LearnSpace History Lab", youtubeIdAt(1), 0.96],
      ...recommendations.map((id, index) => [id, `Home E2E recommendation ${index + 1}`, "LearnSpace Recommendation Lab", youtubeIdAt(index + 2), 0.95 - index * 0.01]),
    ] as const;
    for (const [resourceId, title, channel, youtubeId, quality] of videoRows) {
      await tx`
        INSERT INTO catalog.resources
          (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
        VALUES
          (${resourceId}, NULL, 'video', 'youtube', ${`home-e2e-${resourceId}`}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${title}, 'Deterministic populated Home content.', 'en', 'public', 'ready', ${quality}, '{"test":true}'::jsonb)
      `;
      await tx`
        INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title, duration_ms, published_at)
        VALUES (${resourceId}, ${youtubeId}, ${channel}, 600000, ${ago(2)})
      `;
      await tx`
        INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary)
        VALUES (${resourceId}, ${concept.id}, 'home-e2e', 1, true)
      `;
    }
    await tx`
      INSERT INTO catalog.resources
        (id, owner_user_id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES
        (${paper}, NULL, 'paper', 'arxiv', ${`home-e2e-paper-${paper}`}, 'https://arxiv.org/abs/2401.00001', 'Home E2E research paper', 'Deterministic paper history content.', 'en', 'public', 'ready', 0.94, '{"test":true}'::jsonb)
    `;
    await tx`
      INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date)
      VALUES (${paper}, '2401.00001', 'A deterministic Home E2E abstract.', 'LearnSpace Research', current_date)
    `;

    const sessions = [
      [heroSession, hero, "active", "guided_learning", ago(0.15)],
      [olderSession, olderVideo, "paused", "guided_learning", ago(3)],
      [paperSession, paper, "paused", "research", ago(6)],
    ] as const;
    for (const [sessionId, resourceId, status, mode, lastActiveAt] of sessions) {
      await tx`
        INSERT INTO study.study_sessions
          (id, user_id, title, mode, status, active_resource_id, started_at, last_active_at, metadata)
        VALUES
          (${sessionId}, ${userId}, 'Home E2E session', ${mode}, ${status}, ${resourceId}, ${ago(8)}, ${lastActiveAt}, '{"test":true}'::jsonb)
      `;
      await tx`
        INSERT INTO study.session_resources
          (study_session_id, resource_id, binding_status, role, position, added_by)
        VALUES (${sessionId}, ${resourceId}, 'preparing', 'primary', 0, 'user')
      `;
    }
    await tx`
      INSERT INTO study.user_resource_progress
        (user_id, resource_id, last_session_id, status, progress_pct, last_anchor, first_started_at, last_opened_at, updated_at)
      VALUES
        (${userId}, ${hero}, ${heroSession}, 'active', 32, '{"kind":"video","positionMs":192000}'::jsonb, ${ago(8)}, ${ago(0.15)}, ${ago(0.15)}),
        (${userId}, ${olderVideo}, ${olderSession}, 'active', 74, '{"kind":"video","positionMs":444000}'::jsonb, ${ago(8)}, ${ago(3)}, ${ago(3)}),
        (${userId}, ${paper}, ${paperSession}, 'active', 61, '{"kind":"paper","page":4}'::jsonb, ${ago(8)}, ${ago(6)}, ${ago(6)})
    `;
  });

  const sessionToken = (await createSession(userId, { userAgent: "home-e2e" }, process.env.AUTH_SECRET ?? "")).token;
  return { userId, email, sessionToken, resources: { hero, olderVideo, paper, recommendations }, sessions: { hero: heroSession, olderVideo: olderSession, paper: paperSession } };
}

export async function cleanupHomeFixture(database: Database, fixture: HomeFixture): Promise<void> {
  const resourceIds = [fixture.resources.hero, fixture.resources.olderVideo, fixture.resources.paper, ...fixture.resources.recommendations];
  await database`DELETE FROM discovery.discovery_interactions WHERE user_id = ${fixture.userId} OR resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${fixture.userId} OR resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${fixture.userId}) OR resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM discovery.recommendation_runs WHERE user_id = ${fixture.userId}`;
  await database`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${fixture.userId}`;
  await database`DELETE FROM ops.outbox_events WHERE user_id = ${fixture.userId}`;
  await database`DELETE FROM ops.idempotency_records WHERE user_id = ${fixture.userId}`;
  await database`DELETE FROM activity.activity_events WHERE user_id = ${fixture.userId} OR resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId})`;
  await database`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId})`;
  await database`DELETE FROM study.user_resource_progress WHERE user_id = ${fixture.userId} OR resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId}) OR resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM study.study_sessions WHERE user_id = ${fixture.userId}`;
  await database`DELETE FROM catalog.resource_concepts WHERE resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM catalog.video_details WHERE resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM catalog.paper_details WHERE resource_id IN ${database(resourceIds)}`;
  await database`DELETE FROM catalog.resources WHERE id IN ${database(resourceIds)}`;
  await database`DELETE FROM identity.users WHERE id = ${fixture.userId}`;
}

export async function stabilizeHomeRecommendations(database: Database, fixture: HomeFixture, runId: string): Promise<void> {
  const candidates = await database<{ resource_id: string }[]>`
    SELECT resource_id FROM discovery.recommendation_candidates WHERE recommendation_run_id = ${runId}
  `;
  const candidateIds = new Set(candidates.map((candidate) => candidate.resource_id));
  for (const resourceId of fixture.resources.recommendations) {
    if (!candidateIds.has(resourceId)) throw new Error(`Home recommendation fixture is missing candidate ${resourceId}`);
  }
  await database`
    UPDATE discovery.recommendation_candidates
    SET final_rank = NULL, selected = false
    WHERE recommendation_run_id = ${runId}
  `;
  for (const [index, resourceId] of fixture.resources.recommendations.entries()) {
    await database`
      UPDATE discovery.recommendation_candidates
      SET final_rank = ${index + 1}, selected = true
      WHERE recommendation_run_id = ${runId} AND resource_id = ${resourceId}
    `;
  }
  await invalidateHomeFeedCache(fixture.userId);
}

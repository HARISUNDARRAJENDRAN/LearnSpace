/**
 * What the Notes benchmarks share: a network round trip added to every database connection, a lesson with a ready
 * transcript, signed-in learners through onboarding, the check every request passes first, and cleaning it all up.
 * Local databases only.
 */
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import type postgres from "postgres";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A TCP proxy to Postgres that holds every chunk for half the round trip in each direction, keeping order. */
export function latencyProxy(target: { host: string; port: number }, rttMs: number): Promise<{ port: number; close: () => void }> {
  const sockets = new Set<net.Socket>();
  const delayed = (from: net.Socket, to: net.Socket) => {
    let chain = Promise.resolve();
    from.on("data", (chunk) => {
      const due = Date.now() + rttMs / 2;
      chain = chain.then(async () => { const wait = due - Date.now(); if (wait > 0) await sleep(wait); if (!to.destroyed) to.write(chunk); });
    });
    from.on("close", () => { void chain.then(() => to.destroy()); });
    from.on("error", () => to.destroy());
  };
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    client.setNoDelay(true); upstream.setNoDelay(true);
    sockets.add(client); sockets.add(upstream);
    delayed(client, upstream);
    delayed(upstream, client);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    port: (server.address() as net.AddressInfo).port,
    close: () => { for (const socket of sockets) socket.destroy(); server.close(); },
  })));
}

export const through = (url: string, port: number) => { const parsed = new URL(url); parsed.hostname = "127.0.0.1"; parsed.port = String(port); return parsed.toString(); };

export type Lesson = { videoId: string; versionId: string };

/** A 40-minute lesson: one caption chunk every 6 s, as the transcript service writes them. */
export async function createLesson(migrator: postgres.Sql): Promise<Lesson> {
  const videoId = randomUUID();
  const versionId = randomUUID();
  const youtubeId = `b${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const chunks = Array.from({ length: 400 }, (_, index) => `Line ${index}: the gradient points uphill, so each step of descent moves the weights the other way by the learning rate.`);
  await migrator`INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, visibility, status, quality_score, metadata)
    VALUES (${videoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'Benchmark lesson', 'public', 'ready', 0.9, '{"benchmark":true}'::jsonb)`;
  await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${videoId}, ${youtubeId}, 2400000)`;
  await migrator`INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
    VALUES (${versionId}, ${videoId}, 1, ${"e".repeat(64)}, ${"e".repeat(64)}, ${`transcripts/${videoId}`}, 'application/json', 'learner-captions', '1', 'ready', now(), now())`;
  await migrator`INSERT INTO retrieval.resource_chunks ${migrator(chunks.map((content, ordinal) => ({
    // "paragraph", not "transcript": the background worker embeds new transcript chunks, and would compete with the measurement.
    resource_version_id: versionId, ordinal, chunk_type: "paragraph", content, content_sha256: createHash("sha256").update(content).digest("hex"),
    token_count: Math.ceil(content.length / 4), language: "en", start_ms: ordinal * 6_000, end_ms: ordinal * 6_000 + 5_900,
  })))}`;
  await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${videoId}`;
  return { videoId, versionId };
}

type Modules = {
  repository: typeof import("../lib/auth/repository");
  study: typeof import("../lib/study/service");
  onboarding: typeof import("../lib/onboarding/service");
};

export async function appModules(): Promise<Modules> {
  const [repository, study, onboarding] = await Promise.all([import("../lib/auth/repository"), import("../lib/study/service"), import("../lib/onboarding/service")]);
  return { repository, study, onboarding };
}

/**
 * requireCompletedSession without the cookie, as the code at hand makes it: one lookup where it has one, else the session
 * lookup and then the onboarding state, as it was.
 */
export function gateOf({ repository, onboarding }: Modules): (token: string) => Promise<void> {
  const lookup = (repository as Record<string, unknown>).findSessionWithOnboarding as ((token: string) => Promise<{ onboarding: { completedAt: Date | null } | null } | null>) | undefined;
  return lookup
    ? async (token) => { if (!(await lookup(token))?.onboarding?.completedAt) throw new Error("the gate refused the learner"); }
    : async (token) => {
      const found = await repository.findSessionByToken(token);
      if (!found || !(await onboarding.getOnboardingState(found.user.id)).completed) throw new Error("the gate refused the learner");
    };
}

export type Learner = { userId: string; sessionId: string; token: string };

/** A learner signed in and through onboarding with three topics, in a Study session on the lesson, as in a Notes session. */
export async function createLearner(migrator: postgres.Sql, { repository, study }: Modules, lesson: Lesson): Promise<Learner> {
  const conceptIds = (await migrator<{ id: string }[]>`SELECT id FROM knowledge.concepts WHERE status = 'active' ORDER BY id LIMIT 3`).map((row) => row.id);
  const user = await repository.createEmailUser({ email: `notes-bench-${randomUUID()}@example.test`, displayName: "Bench", passwordHash: "bench" });
  const { sessionId } = await study.startOrResumeStudySession(user.id, { resourceId: lesson.videoId, origin: "home", idempotencyKey: `bench-${randomUUID()}` });
  const { token } = await repository.createSession(user.id, {}, "bench-secret-bench-secret-bench-secret-00");
  await migrator`UPDATE identity.user_settings SET onboarding_completed_at = now(), onboarding_version = 1,
    learning_preferences = ${migrator.json({ persona: "student", conceptIds, learningIntents: ["coursework"], preferredFormats: [], preferredDuration: "no_preference" })} WHERE user_id = ${user.id}`;
  return { userId: user.id, sessionId, token };
}

export async function removeFixture(migrator: postgres.Sql, { videoId, versionId }: Lesson, users: string[]): Promise<void> {
  if (users.length) {
    await migrator`DELETE FROM study.video_notes WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.session_transcript WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id IN (SELECT id FROM retrieval.retrieval_runs WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM retrieval.retrieval_runs WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM agent.agent_runs WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM activity.activity_events WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id IN ${migrator(users)})`;
    await migrator`DELETE FROM study.study_sessions WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM discovery.user_concept_affinity WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id IN ${migrator(users)}`;
    await migrator`DELETE FROM identity.users WHERE id IN ${migrator(users)}`;
  }
  await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${videoId}`;
  // The background worker may have embedded the lesson meanwhile.
  await migrator`DELETE FROM retrieval.chunk_embeddings WHERE chunk_id IN (SELECT id FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId})`;
  await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
  await migrator`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
  await migrator`DELETE FROM ops.transcript_requests WHERE resource_id = ${videoId}`;
  await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
  await migrator`DELETE FROM catalog.resources WHERE id = ${videoId}`;
}

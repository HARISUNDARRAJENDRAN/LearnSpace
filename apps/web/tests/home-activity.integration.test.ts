import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

test("first entry is persistent, and measured Home activity is scoped and counted once", { skip: !process.env.DATABASE_MIGRATOR_URL }, async () => {
  const [{ closeDb }, { createEmailUser }, { getLearnHome }, { getAuthenticatedDestination, recordFirstApplicationVisit }, { recordStudyFocus, studyFocusIntervalSchema }] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/home/service"), import("../lib/onboarding/service"), import("../lib/study/focus"),
  ]);
  const database = postgres(process.env.DATABASE_MIGRATOR_URL ?? "", { max: 1, prepare: false });
  const owner = await createEmailUser({ email: `home-activity-${randomUUID()}@example.test`, displayName: "Activity test", passwordHash: "test" });
  const other = await createEmailUser({ email: `home-isolation-${randomUUID()}@example.test`, displayName: "Isolation test", passwordHash: "test" });
  const resourceId = randomUUID();
  const sessionId = randomUUID();
  try {
    assert.equal(await recordFirstApplicationVisit(owner.id), false);
    assert.equal(await getAuthenticatedDestination(owner.id), "/onboarding");
    await database`UPDATE identity.user_settings SET onboarding_completed_at = now(), onboarding_version = 1 WHERE user_id IN ${database([owner.id, other.id])}`;
    assert.equal(await getAuthenticatedDestination(owner.id), "/app/discover");
    const claims = await Promise.all([recordFirstApplicationVisit(owner.id), recordFirstApplicationVisit(owner.id)]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await recordFirstApplicationVisit(owner.id), false);
    assert.equal(await getAuthenticatedDestination(owner.id), "/app");
    assert.equal(await getAuthenticatedDestination(owner.id, "/app/library"), "/app/library");
    assert.equal(await getAuthenticatedDestination(other.id), "/app/discover");
    assert.deepEqual((await getLearnHome(owner.id)).activity.days, []);

    await database`UPDATE identity.users SET timezone = 'Asia/Kolkata' WHERE id = ${owner.id}`;
    await database`INSERT INTO catalog.resources (id, owner_user_id, type, provider, title, visibility, status) VALUES (${resourceId}, ${owner.id}, 'video', 'youtube', 'Activity fixture', 'private', 'ready')`;
    await database`INSERT INTO study.study_sessions (id, user_id, title, mode, started_at) VALUES (${sessionId}, ${owner.id}, 'Activity fixture', 'guided_learning', now() - interval '5 minutes')`;
    await database`INSERT INTO study.session_resources (study_session_id, resource_id, role, added_by, binding_status) VALUES (${sessionId}, ${resourceId}, 'primary', 'user', 'preparing')`;
    const now = Date.now();
    const interval = { id: randomUUID(), resourceId, startedAt: now - 45_000, endedAt: now - 30_000 };
    assert.equal((await recordStudyFocus(owner.id, sessionId, interval)).seconds, 15);
    assert.equal((await recordStudyFocus(owner.id, sessionId, interval)).seconds, 15);
    assert.equal((await recordStudyFocus(owner.id, sessionId, { ...interval, id: randomUUID(), startedAt: now - 40_000, endedAt: now - 25_000 })).seconds, 5);
    assert.equal((await recordStudyFocus(owner.id, sessionId, { ...interval, id: randomUUID(), startedAt: now - 50_000, endedAt: now - 35_000 })).seconds, 5);
    const home = await getLearnHome(owner.id);
    assert.equal(home.activity.days.reduce((sum, day) => sum + day.focusSeconds, 0), 25);
    assert.equal(home.activity.days.reduce((sum, day) => sum + day.videoSeconds, 0), 25);
    assert.equal(home.activity.today, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
    assert.deepEqual((await getLearnHome(other.id)).activity.days, []);
    await assert.rejects(() => recordStudyFocus(other.id, sessionId, { ...interval, id: randomUUID() }), /not available/);
    await assert.rejects(() => recordStudyFocus(owner.id, sessionId, { ...interval, id: randomUUID(), endedAt: now + 20_000, startedAt: now }), /recent active/);
    assert.equal(studyFocusIntervalSchema.safeParse({ ...interval, endedAt: interval.startedAt + 31_000 }).success, false);
    assert.equal(await getAuthenticatedDestination(owner.id), "/app");
  } finally {
    await database`DELETE FROM activity.activity_events WHERE user_id IN ${database([owner.id, other.id])}`;
    await database`DELETE FROM ops.outbox_events WHERE user_id IN ${database([owner.id, other.id])}`;
    await database`DELETE FROM study.focus_sessions WHERE user_id IN ${database([owner.id, other.id])}`;
    await database`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
    await database`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
    await database`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
    await database`DELETE FROM identity.users WHERE id IN ${database([owner.id, other.id])}`;
    await database.end({ timeout: 5 });
    await closeDb();
  }
});

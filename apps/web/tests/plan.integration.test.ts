import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL);

test(
  "the study plan is private, and the observer completes it from recorded study",
  { skip: databaseAvailable ? false : "DATABASE_URL, DATABASE_AUTH_URL, and DATABASE_MIGRATOR_URL are required" },
  async () => {
    const [{ closeDb, withUserTransaction }, { createEmailUser }, { getLearnHome }, plan, { observePlan, tickPlanItem }] = await Promise.all([
      import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/home/service"), import("../lib/plan/service"), import("../lib/plan/observer"),
    ]);
    const migrator = postgres(process.env.DATABASE_MIGRATOR_URL ?? "", { max: 1, prepare: false });
    const owner = await createEmailUser({ email: `plan-owner-${randomUUID()}@example.test`, displayName: "Plan owner", passwordHash: "test" });
    const other = await createEmailUser({ email: `plan-other-${randomUUID()}@example.test`, displayName: "Plan other", passwordHash: "test" });
    const users = [owner.id, other.id];
    const resourceId = randomUUID();
    const sessionId = randomUUID();
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENAI_API_KEY;
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    try {
      await migrator`UPDATE identity.users SET timezone = 'UTC' WHERE id IN ${migrator(users)}`;
      await migrator`INSERT INTO catalog.resources (id, owner_user_id, type, provider, title, visibility, status) VALUES (${resourceId}, ${owner.id}, 'video', 'youtube', 'Java inheritance explained', 'private', 'ready')`;
      await migrator`INSERT INTO study.study_sessions (id, user_id, title, mode, started_at) VALUES (${sessionId}, ${owner.id}, 'Java', 'guided_learning', now() - interval '2 hours')`;
      await migrator`INSERT INTO study.session_resources (study_session_id, resource_id, role, added_by, binding_status) VALUES (${sessionId}, ${resourceId}, 'primary', 'user', 'preparing')`;
      await migrator`INSERT INTO study.user_resource_progress (user_id, resource_id, last_session_id, status, progress_pct, first_started_at, last_opened_at) VALUES (${owner.id}, ${resourceId}, ${sessionId}, 'active', 40, now() - interval '1 hour', now() - interval '10 minutes')`;

      const study = await plan.createPlanItem(owner.id, { title: "Watch Java inheritance", description: null, kind: "watch", startsAt: minutesAgo(30), endsAt: minutesAgo(0), allDay: false });
      assert.equal(study.status, "planned");
      assert.equal(study.resource, null);
      assert.equal(plan.planItemInputSchema.safeParse({ title: "Backwards", description: null, kind: "watch", startsAt: minutesAgo(0), endsAt: minutesAgo(30), allDay: false }).success, false);
      assert.equal(plan.planItemPatchSchema.safeParse({ status: "done" }).success, false);
      // Picking a session's material sets the title and the type; free text gets its type from the words.
      const linked = await plan.createPlanItem(owner.id, { description: null, startsAt: minutesAgo(-60), endsAt: minutesAgo(-90), allDay: false, resourceId, studySessionId: sessionId });
      assert.deepEqual([linked.title, linked.kind, linked.resource?.id], ["Watch Java inheritance explained", "watch", resourceId]);
      await assert.rejects(() => plan.createPlanItem(other.id, { description: null, startsAt: minutesAgo(-60), endsAt: null, allDay: true, resourceId }), /not available/);
      const solve = await plan.createPlanItem(owner.id, { title: "Solve 5 recursion problems", description: null, startsAt: minutesAgo(-60), endsAt: null, allDay: true });
      assert.equal(solve.kind, "practice");
      assert.equal((await plan.updatePlanItem(owner.id, solve.id, { title: "Recap recursion" })).kind, "review");
      assert.equal(plan.planItemInputSchema.safeParse({ description: null, startsAt: minutesAgo(30), endsAt: null, allDay: true }).success, false);
      await plan.deletePlanItem(owner.id, linked.id);
      await plan.deletePlanItem(owner.id, solve.id);
      await assert.rejects(() => plan.updatePlanItem(other.id, study.id, { title: "Mine now" }), /no longer exists/);
      await assert.rejects(() => plan.deletePlanItem(other.id, study.id), /no longer exists/);
      await assert.rejects(() => plan.updatePlanItem(owner.id, study.id, { status: "planned" }), /Only suggestions/);
      await assert.rejects(() => plan.updatePlanItem(owner.id, study.id, { status: "dismissed" }), /Only the planner/);
      assert.deepEqual(await plan.listPlanItems(other.id, minutesAgo(120), minutesAgo(-120)), []);
      assert.deepEqual((await plan.listPlanItems(owner.id, minutesAgo(120), minutesAgo(-120))).map((item) => item.id), [study.id]);

      // A tick is a request to check: with no study behind it, the to-do stays open and says why.
      delete process.env.OPENAI_API_KEY;
      const todo = await plan.createPlanItem(owner.id, { title: "Book the study room", description: null, kind: "review", startsAt: minutesAgo(60), endsAt: null, allDay: true });
      const unbacked = await tickPlanItem(owner.id, todo.id, true);
      assert.equal(unbacked.verified, false);
      assert.match(unbacked.note, /No study/);
      assert.equal((await plan.getPlanItem(owner.id, todo.id)).status, "planned");
      await assert.rejects(() => tickPlanItem(other.id, todo.id, true), /no longer exists/);
      assert.equal(plan.planItemPatchSchema.safeParse({ done: true }).success, false);
      await plan.deletePlanItem(owner.id, todo.id);
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;

      // A goal from onboarding becomes all-day to-dos; without a model the goal itself is today's to-do.
      delete process.env.OPENAI_API_KEY;
      const { planGoal } = await import("../lib/plan/goal");
      const midnight = new Date();
      midnight.setUTCHours(0, 0, 0, 0);
      assert.deepEqual(await planGoal(owner.id, { goal: "Get comfortable with recursion", days: [midnight.toISOString()] }), { created: 1 });
      const goalItems = (await plan.listPlanItems(owner.id, midnight.toISOString(), new Date(midnight.getTime() + 86_400_000).toISOString())).filter((item) => item.allDay);
      assert.deepEqual(goalItems.map((item) => [item.title, item.allDay, item.status, item.source]), [["Get comfortable with recursion", true, "planned", "agent"]]);
      await plan.deletePlanItem(owner.id, goalItems[0]!.id);
      if (originalKey) process.env.OPENAI_API_KEY = originalKey;

      // 35 recorded video minutes cover the 30 planned for a Watch item; without a model, kind and time decide.
      // The item was planned well before it started, so it can earn the on-time and in-slot bonuses.
      delete process.env.OPENAI_API_KEY;
      await migrator`UPDATE study.schedule_items SET created_at = now() - interval '2 hours' WHERE id = ${study.id}`;
      await migrator`INSERT INTO study.focus_sessions (user_id, study_session_id, resource_id, mode, started_at, ended_at, duration_sec, completed) VALUES (${owner.id}, ${sessionId}, ${resourceId}, 'guided_learning', now() - interval '36 minutes', now() - interval '1 minute', 2100, true)`;
      await migrator`INSERT INTO activity.activity_events (schema_version, user_id, study_session_id, event_type, actor_type, source, occurred_at) VALUES (1, ${owner.id}, ${sessionId}, 'question.asked', 'user', 'web', now() - interval '5 minutes')`;
      assert.equal((await observePlan(owner.id)).changed, true);
      const [observed] = await plan.listPlanItems(owner.id, minutesAgo(120), minutesAgo(-120));
      assert.equal(observed?.status, "done");
      assert.equal(observed?.progressPct, 100);
      assert.equal(observed?.observerNote, "Studied 30 of 30 planned min.");
      const home = await getLearnHome(owner.id);
      const { in_slot: inSlot, ...earned } = home.progression.earned;
      // Study started 6 min before the slot and ran to a minute before its end: on time, and 29 of 30 slot minutes used.
      assert.deepEqual(earned, { watch: 35, read: 0, finish_video: 0, finish_paper: 0, question: 5, plan_watch: 20, plan_read: 0, plan_practice: 0, plan_review: 0, on_time: 10, day_plan: 25, streak: 0 });
      assert.equal(inSlot, 14);
      // The fallback planner put finishing the open lesson straight onto the calendar.
      assert.deepEqual(home.nextActions.map((item) => [item.title, item.resource?.id, item.source, item.status]), [["Finish Java inheritance explained", resourceId, "agent", "planned"]]);

      // Study from before a to-do was planned never completes it; study after it does.
      const recap = await plan.createPlanItem(owner.id, { title: "Recap inheritance", description: null, startsAt: minutesAgo(0), endsAt: null, allDay: true });
      assert.equal(recap.kind, "review");
      assert.equal((await tickPlanItem(owner.id, recap.id, true)).verified, false);
      await migrator`UPDATE study.schedule_items SET created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour' WHERE id = ${recap.id}`;
      assert.deepEqual(await tickPlanItem(owner.id, recap.id, true), { verified: true, note: "Studied 30 of 30 planned min." });
      const recapped = await plan.getPlanItem(owner.id, recap.id);
      assert.deepEqual([recapped.status, recapped.progressPct], ["done", 100]);
      assert.equal((await tickPlanItem(owner.id, recap.id, false)).verified, false);
      assert.deepEqual([(await plan.getPlanItem(owner.id, recap.id)).status, (await plan.getPlanItem(owner.id, recap.id)).progressPct], ["planned", 0]);
      await plan.deletePlanItem(owner.id, recap.id);

      // With a model: free-text items are judged and next actions stay grounded in real resources.
      process.env.OPENAI_API_KEY = "test-key";
      await migrator`DELETE FROM study.schedule_items WHERE user_id = ${owner.id} AND source = 'agent'`;
      const task = await plan.createPlanItem(owner.id, { title: "Understand method overriding", description: null, kind: "practice", startsAt: minutesAgo(40), endsAt: minutesAgo(10), allDay: false });
      await migrator`UPDATE study.schedule_items SET created_at = now() - interval '2 hours', updated_at = now() - interval '2 hours' WHERE id = ${task.id}`;
      const requests: string[] = [];
      globalThis.fetch = async (input, init) => {
        if (String(input) !== "https://api.openai.com/v1/chat/completions") return originalFetch(input, init);
        const body = JSON.parse(String(init?.body)) as { response_format: { json_schema: { name: string } }; messages: { content: string }[] };
        const name = body.response_format.json_schema.name;
        requests.push(name);
        const reply = name === "plan_verdicts"
          ? { items: [{ id: task.id, progressPct: 100, done: true, note: "Watched 35 min of Java inheritance explained." }, { id: study.id, progressPct: 0, done: false, note: "Not yours to judge." }] }
          : { actions: [
            { title: "Finish Java inheritance", reason: "You are 40% through it.", kind: "watch", minutes: 25, when: "today", resourceId, searchQuery: "Java inheritance" },
            { title: "Study polymorphism in Java", reason: "It builds on inheritance.", kind: "practice", minutes: 45, when: "tomorrow", resourceId: randomUUID(), searchQuery: "zz-no-such-material polymorphism" },
          ] };
        assert.match(body.messages[1]?.content ?? "", name === "plan_verdicts" ? /Java inheritance explained/ : /alreadyPlanned/);
        return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
      };
      assert.equal((await observePlan(owner.id)).changed, true);
      assert.deepEqual(requests.toSorted(), ["next_actions", "plan_verdicts"]);
      const items = (await plan.listPlanItems(owner.id, minutesAgo(120), minutesAgo(-120))).filter((item) => item.source === "learner");
      assert.deepEqual(items.map((item) => [item.title, item.status]), [["Understand method overriding", "done"], ["Watch Java inheritance", "done"]]);
      assert.equal(items[0]?.observerNote, "Watched 35 min of Java inheritance explained.");
      const suggestions = await withUserTransaction(owner.id, (tx) => plan.listPlanSuggestions(tx, owner.id));
      assert.deepEqual(suggestions.map((item) => [item.title, item.kind, item.resource?.id ?? null]), [["Finish Java inheritance", "watch", resourceId], ["Study polymorphism in Java", "practice", null]]);
      // The model cannot invent a resource id; an unknown one is dropped.
      assert.equal(suggestions.every((item) => new Date(item.endsAt ?? 0) > new Date(item.startsAt)), true);

      // Nothing new happened, so a second tick asks the model nothing.
      assert.equal((await observePlan(owner.id)).changed, false);
      assert.equal(requests.length, 2);

      // Planner items are already planned; the learner can dismiss one, and deleting one dismisses it so it is not suggested again.
      const [first, second] = suggestions;
      assert.equal(first?.status, "planned");
      assert.equal((await plan.updatePlanItem(owner.id, first!.id, { status: "dismissed" })).status, "dismissed");
      await plan.deletePlanItem(owner.id, second!.id);
      assert.equal((await plan.getPlanItem(owner.id, second!.id)).status, "dismissed");
      assert.deepEqual(await withUserTransaction(owner.id, (tx) => plan.listPlanSuggestions(tx, owner.id)), []);
      await assert.rejects(() => plan.deletePlanItem(owner.id, second!.id), /no longer exists/);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
      await migrator`DELETE FROM study.schedule_items WHERE user_id IN ${migrator(users)}`;
      await migrator`DELETE FROM study.focus_sessions WHERE user_id IN ${migrator(users)}`;
      await migrator`DELETE FROM activity.activity_events WHERE user_id IN ${migrator(users)}`;
      await migrator`DELETE FROM study.user_resource_progress WHERE user_id IN ${migrator(users)}`;
      await migrator`DELETE FROM study.session_resources WHERE study_session_id = ${sessionId}`;
      await migrator`DELETE FROM study.study_sessions WHERE id = ${sessionId}`;
      await migrator`DELETE FROM catalog.resources WHERE id = ${resourceId}`;
      await migrator`DELETE FROM identity.users WHERE id IN ${migrator(users)}`;
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);

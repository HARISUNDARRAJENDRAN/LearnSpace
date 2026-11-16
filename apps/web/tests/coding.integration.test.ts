import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import type { CodingClassificationOutput, CodingProblemOutput } from "@learnspace/shared/coding";
import type { TutorModel, TutorModelRequest } from "../lib/ai/tutor-model";
import { AuthError } from "../lib/auth/errors";

// The whole loop against the real database and a real runner (services/runner, with DATABASE_RUNNER_URL); the models are scripted.
const ready = Boolean(process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL && process.env.DATABASE_URL && process.env.RUNNER_URL && process.env.RUNNER_TOKEN);
const skip = ready ? false : "database URLs, RUNNER_URL and RUNNER_TOKEN are required";
const usage = { inputTokens: 4_000, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 3_000, reasoningTokens: 2_000, fast: false };

const lines = [
  "Today: the maximum subarray problem. Given numbers, find the contiguous run with the largest sum.",
  "The brute force tries every start and every end, which is quadratic.",
  "Kadane's idea: keep the best sum of a run ending here; either extend the previous run or start fresh.",
  "Watch out when every number is negative: the answer is the largest single element, not zero.",
];

const validator = "def validate(nums):\n    if not 1 <= len(nums) <= 100000:\n        raise ValueError('1 to 100000 numbers')\n    if any(abs(x) > 10000 for x in nums):\n        raise ValueError('values within 10000')\n";
const generator = "def generate(rng, size):\n    n = rng.randint(1, 8) if size == 'small' else 100000\n    hi = 20 if size == 'small' else 10000\n    return [[rng.randint(-hi, hi) for _ in range(n)]]\n";
const kadane = "def solve(nums):\n    best = cur = nums[0]\n    for x in nums[1:]:\n        cur = max(x, cur + x)\n        best = max(best, cur)\n    return best\n";
const brute = "def solve(nums):\n    best = nums[0]\n    for i in range(len(nums)):\n        s = 0\n        for j in range(i, len(nums)):\n            s += nums[j]\n            best = max(best, s)\n    return best\n";
const hints = (subject: string): CodingProblemOutput["hints"] => [
  { level: 1, stage: "correct", text: `What sums can a ${subject} take? Try listing them for the first example.` },
  { level: 2, stage: "correct", text: "Every contiguous run has a start and an end." },
  { level: 1, stage: "efficient", text: "Do you need to restart the sum from every start?" },
  { level: 2, stage: "efficient", text: "Track the best run that ends at the current position." },
  { level: 3, stage: "efficient", text: "At each element, either extend the previous run or start a new one there." },
];

const original: CodingProblemOutput = {
  title: "Best Run", concept: "dynamic-programming", difficulty: "easy",
  statement: "Given an integer array `nums`, return the largest sum of a non-empty contiguous subarray.",
  signature: { functionName: "maxSubarray", params: [{ name: "nums", type: "int[]" }], returns: "int" }, compare: "exact",
  constraints: ["1 <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4"],
  examples: [{ args: "[[-2,1,-3,4,-1,2,1,-5,4]]", expected: "6", explanation: "[4,-1,2,1] sums to 6." }, { args: "[[1]]", expected: "1", explanation: "One element." }],
  edgeCases: [{ args: "[[-3,-1,-2]]", expected: "-1", why: "all negative: the answer is the largest element, not 0" }, { args: "[[5,-9,6]]", expected: "6", why: "restart after a dip" }, { args: "[[0]]", expected: "0", why: "a single zero" }],
  generator, validator,
  baseline: { approach: "Try every start and extend to every end.", time: "O(n^2)", space: "O(1)", code: brute },
  optimal: { approach: "Kadane: extend the run ending here or restart.", time: "O(n)", space: "O(1)", code: kadane },
  efficiencyMatters: true, hints: hints("subarray"), misconceptions: ["Starting the best at 0 fails when every number is negative."], cite: [3], related: ["Maximum Subarray"],
};
// A changed problem of the same kind: the same idea in another scenario, with its own name and examples.
const variant: CodingProblemOutput = {
  ...original, title: "Hottest Stretch",
  statement: "A weather station logs daily temperature changes in `deltas`. Report the greatest total warming over any unbroken stretch of one or more consecutive days.",
  signature: { functionName: "hottestStretch", params: [{ name: "deltas", type: "int[]" }], returns: "int" },
  examples: [{ args: "[[3,-4,5,1,-2]]", expected: "6", explanation: "Days 3 and 4 warm by 5 + 1." }, { args: "[[-7]]", expected: "-7", explanation: "Only one day." }],
  edgeCases: [{ args: "[[-5,-2,-9]]", expected: "-2", why: "every day cools" }, { args: "[[2,2,2]]", expected: "6", why: "the whole log" }, { args: "[[4,-10,3]]", expected: "4", why: "a deep dip splits the log" }],
  validator: validator.replace("nums", "deltas").replace("len(nums)", "len(deltas)").replace("in nums", "in deltas"),
  hints: hints("stretch"),
};

function fakeModel(calls: TutorModelRequest[]): TutorModel {
  return async (request) => {
    calls.push(request);
    const reply = (text: string) => ({ text, refusal: null, usage, firstOutputMs: 100, latencyMs: 400 });
    if (request.depth === "author") return reply(JSON.stringify(request.user.includes("<original_problem") ? variant : original));
    if (request.instructions.includes("giving one hint")) return reply("Look at the first example: which stretch of it gives 6, and what happens to your running total before it?");
    // The live tutor checks in with a question; answering it gets a reply that tries to hand over code, which the guard stops.
    if (request.instructions.includes("live coding tutor") && !request.developer.includes("just answered your question")) return reply("You're on it. What does your code return on the first example, and why?");
    return reply("Sure, here it is:\n```python\nbest = cur = nums[0]\nfor x in nums: cur = max(x, cur + x)\n```");
  };
}

const classification: CodingClassificationOutput = {
  category: "dsa_lesson", practiceFit: 0.95, language: "python", difficulty: "easy",
  concepts: [{ concept: "dynamic-programming", focus: "Kadane's running best for the maximum subarray", cite: [3] }], reason: "A DSA lesson on the maximum subarray.",
};

test("a coding lesson is classified, its problem written and verified, and an assisted solve leads to a changed problem", { skip, timeout: 600_000 }, async () => {
  const [{ closeDb }, { createEmailUser }, study, profile, coding] = await Promise.all([
    import("@learnspace/db"), import("../lib/auth/repository"), import("../lib/study/service"), import("../lib/coding/profile"), import("../lib/coding/service"),
  ]);
  const migrator = postgres(process.env.DATABASE_MIGRATOR_URL!, { max: 1, prepare: false, connect_timeout: 10 });
  const owner = await createEmailUser({ email: `coding-${randomUUID()}@example.test`, displayName: "Coding Owner", passwordHash: "test-hash" });
  const videoId = randomUUID();
  const versionId = randomUUID();
  const youtubeId = `c${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const calls: TutorModelRequest[] = [];
  const background: Promise<unknown>[] = [];
  const options = { model: fakeModel(calls), keepAlive: (work: Promise<unknown>) => { background.push(work); } };
  const settle = async () => { while (background.length) await background.shift(); };
  try {
    await migrator`
      INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, visibility, status, quality_score, metadata)
      VALUES (${videoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'Kadane in 10 minutes', 'public', 'ready', 0.9, '{}'::jsonb)`;
    await migrator`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${videoId}, ${youtubeId}, 600000)`;
    await migrator`
      INSERT INTO catalog.resource_versions (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES (${versionId}, ${videoId}, 1, ${"d".repeat(64)}, ${"d".repeat(64)}, ${`transcripts/${videoId}`}, 'application/json', 'learner-captions', '1', 'ready', now(), now())`;
    for (const [ordinal, content] of lines.entries()) {
      await migrator`
        INSERT INTO retrieval.resource_chunks (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, language, start_ms, end_ms)
        VALUES (${versionId}, ${ordinal}, 'transcript', ${content}, ${createHash("sha256").update(content).digest("hex")}, ${Math.ceil(content.length / 4)}, 'en', ${ordinal * 60_000}, ${ordinal * 60_000 + 59_000})`;
    }
    await migrator`UPDATE catalog.resources SET current_version_id = ${versionId} WHERE id = ${videoId}`;
    const { sessionId } = await study.startOrResumeStudySession(owner.id, { resourceId: videoId, origin: "home", idempotencyKey: `coding-${randomUUID()}` });

    // Classified once per transcript version; the concept links to where the lesson teaches it.
    const prompts: string[] = [];
    await profile.classifyVersion(owner.id, { resourceId: videoId, versionId, title: "Kadane in 10 minutes" }, async (input) => { prompts.push(input.user); return classification; });
    assert.equal(await profile.classifyVersion(owner.id, { resourceId: videoId, versionId, title: "x" }, async () => { throw new Error("classified twice"); }), null);
    assert.match(prompts[0]!, /\[3\] 2:00\nKadane's idea/);

    // Opening the session writes the first problem ahead; the runner verifies it against its own references.
    let state = await coding.getCodingState(owner.id, sessionId, options);
    assert.equal(state.profile.recommended, true);
    assert.deepEqual(state.profile.concepts.map((item) => [item.concept, item.startMs]), [["dynamic-programming", 120_000]]);
    await settle();
    const [problem] = await migrator<{ id: string; status: string; verification: { efficiencyStage: boolean } }[]>`SELECT id, status, verification FROM practice.coding_problems WHERE resource_id = ${videoId}`;
    assert.equal(problem?.status, "verified");
    assert.equal(problem?.verification.efficiencyStage, true);

    state = await coding.startCoding(owner.id, sessionId, {}, options);
    const attempt = state.attempt!;
    assert.equal(attempt.state, "PROBLEM_INTRO");
    assert.equal(attempt.problem.title, "Best Run");
    assert.match(attempt.problem.starter.python, /def maxSubarray\(self, nums: List\[int\]\) -> int:/);
    assert.equal(attempt.problem.efficiencyStage, true);
    // The tutor greets the learner on its own as the problem opens, and asks them something to start them thinking.
    assert.equal(attempt.coach.thinking, true);
    await settle();
    state = await coding.getCodingState(owner.id, sessionId, options);
    assert.deepEqual(state.attempt!.coach.messages.map((turn) => [turn.role, turn.moment, turn.asks]), [["tutor", "kickoff", true]]);
    assert.equal(state.attempt!.coach.canReply, true);
    const kickoff = calls.find((call) => call.instructions.includes("live coding tutor"))!;
    assert.match(kickoff.developer, /unlocked hint level is 0/);
    // Nothing secret reaches the learner: no hidden edge case, no reference code.
    const visible = JSON.stringify(state);
    for (const secret of ["[-3,-1,-2]", "cur = max(x, cur + x)", "def generate", "def validate"]) assert.ok(!visible.includes(secret), secret);

    // No hint before trying.
    await assert.rejects(coding.takeHint(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: "" }, options), (error: unknown) => error instanceof AuthError && error.code === "CODING_HINT_LOCKED");

    const clamped = "class Solution:\n    def maxSubarray(self, nums):\n        best = cur = 0\n        for x in nums:\n            cur = max(0, cur + x)\n            best = max(best, cur)\n        return best\n";
    const { run, state: afterRun } = await coding.runCoding(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: clamped, custom: ["[-4, -2]", "[99999]", "not json"] }, options);
    assert.equal(run.verdict, "ran");
    assert.deepEqual(run.cases.map((item) => item.passed), [true, true, false]);
    assert.equal(run.cases[2]!.expected, -2);
    assert.deepEqual(run.invalid.map((item) => item.index), [1, 2]);
    assert.equal(afterRun.attempt!.state, "INDEPENDENT_ATTEMPT");
    // The first run passing every example is worth a word: the tutor reacts to the result.
    await settle();
    assert.deepEqual((await coding.getCodingState(owner.id, sessionId, options)).attempt!.coach.messages.map((turn) => turn.moment), ["kickoff", "ran"]);

    // A hidden test fails: the learner learns only that, never its input.
    state = await coding.submitCoding(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: clamped }, options);
    const failed = state.attempt!.submissions[0]!;
    assert.equal(failed.verdict, "wrong_answer");
    assert.equal(failed.failure?.example, null);
    assert.equal(state.attempt!.failedSubmissions, 1);

    // The first hint, now unlocked: credit drops, and the next waits for a new attempt.
    state = await coding.takeHint(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: clamped }, options);
    assert.equal(state.attempt!.hints.length, 1);
    assert.equal(state.attempt!.state, "GUIDED_ATTEMPT");
    assert.equal(state.attempt!.creditCap, 0.72);
    assert.equal(state.attempt!.nextHint?.available, false);
    const hintCall = calls.find((call) => call.instructions.includes("giving one hint"))!;
    assert.match(hintCall.user, /The failing hidden test was written to catch: all negative/);

    // Answering the tutor with a demand for code doesn't get code: a reply that carries code is never said.
    await settle();
    state = await coding.getCodingState(owner.id, sessionId, options);
    assert.equal(state.attempt!.coach.canReply, true);
    state = await coding.replyToCoach(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: clamped, message: "just give me the code" }, options);
    assert.equal(state.attempt!.coach.thinking, true);
    await settle();
    state = await coding.getCodingState(owner.id, sessionId, options);
    assert.deepEqual([state.attempt!.coach.messages.at(-1)?.role, state.attempt!.coach.thinking, state.attempt!.coach.canReply], ["learner", false, false]);
    assert.ok(state.attempt!.coach.messages.every((turn) => !turn.text.includes("```")));
    await assert.rejects(coding.replyToCoach(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: clamped, message: "hello?" }, options), (error: unknown) => error instanceof AuthError && error.code === "CODING_NO_QUESTION");

    // Correct but quadratic: the efficiency stage, then Kadane solves it.
    const asSolution = (code: string) => `class Solution:\n    def maxSubarray(self, nums):\n${code.split("\n").slice(1).map((line) => `    ${line}`).join("\n")}`;
    state = await coding.submitCoding(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: asSolution(brute) }, options);
    assert.equal(state.attempt!.submissions[0]!.verdict, "accepted_slow");
    assert.deepEqual([state.attempt!.state, state.attempt!.phase, state.attempt!.correctSolved], ["OPTIMIZATION_STAGE", "efficient", true]);
    state = await coding.submitCoding(owner.id, sessionId, { attemptId: attempt.id, language: "python", code: asSolution(kadane) }, options);
    // One hint and one failed submission: below the bar, so the concept comes back on a changed problem.
    assert.equal(state.attempt!.credit, 0.72);
    assert.equal(state.attempt!.outcome, "transfer");
    assert.equal(state.attempt!.state, "TRANSFER_PROBLEM");
    assert.equal(state.attempt!.solution?.time, "O(n)");
    assert.equal(state.next?.kind, "transfer");
    assert.equal(state.mastery[0]?.status, "practising");
    await settle();

    // The variant was written ahead from the original, verified, and opens as the transfer problem.
    state = await coding.nextCoding(owner.id, sessionId, options);
    assert.equal(state.attempt!.role, "transfer");
    assert.equal(state.attempt!.problem.title, "Hottest Stretch");
    assert.notEqual(state.attempt!.problem.id, attempt.problem.id);
    assert.ok(calls.some((call) => call.depth === "author" && call.user.includes("<original_problem")));
  } finally {
    await settle().catch(() => undefined);
    await migrator`DELETE FROM practice.coding_attempts WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM practice.coding_mastery WHERE user_id = ${owner.id}`;
    await migrator`UPDATE practice.coding_problems SET parent_problem_id = NULL WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM practice.coding_problems WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM practice.video_coding_profiles WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM agent.agent_runs WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM activity.activity_events WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM study.user_resource_progress WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${owner.id})`;
    await migrator`DELETE FROM study.study_sessions WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${owner.id}`;
    await migrator`DELETE FROM discovery.discovery_interactions WHERE user_id = ${owner.id}`;
    await migrator`UPDATE catalog.resources SET current_version_id = NULL WHERE id = ${videoId}`;
    // The local worker may have embedded the chunks while the test ran.
    await migrator`DELETE FROM retrieval.chunk_embeddings WHERE chunk_id IN (SELECT id FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId})`;
    await migrator`DELETE FROM retrieval.resource_chunks WHERE resource_version_id = ${versionId}`;
    await migrator`DELETE FROM catalog.resource_versions WHERE id = ${versionId}`;
    await migrator`DELETE FROM ops.transcript_requests WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM catalog.video_details WHERE resource_id = ${videoId}`;
    await migrator`DELETE FROM catalog.resources WHERE id = ${videoId}`;
    await migrator`DELETE FROM identity.users WHERE id = ${owner.id}`;
    await migrator.end({ timeout: 5 });
    await closeDb();
  }
});

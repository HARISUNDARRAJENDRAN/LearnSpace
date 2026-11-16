# AI Coding

A LeetCode-style practice workspace that opens beside a video lesson when that
lesson actually teaches code. It writes original problems for the lesson's
concepts, has the code runner verify each one by running it, grades
submissions against hidden tests, and tutors with a hint ladder that costs
credit.

## Flow

1. **Recognition.** When a video session opens, `useCodingProfile` asks
   `GET …/coding`. That call classifies the transcript once per transcript
   version (`lib/coding/profile.ts`, gpt-5-mini, cached in
   `practice.coding_profiles`). The `<> Code` tool appears only when the lesson
   is a `dsa_lesson` or `programming_tutorial` with fit ≥ 0.6 and has
   concepts. The sidebar's **Code Exercises** entry is always there as the
   manual way in.
2. **Problem preparation.** `lib/coding/author.ts` writes a problem for a
   *slot*: concept × difficulty × role (primary, reinforcement or transfer).
   It writes the statement, signature, examples, edge cases with a `why`, a
   brute-force baseline, an optimal reference, a random-input generator, a
   validator and the authored hint ladder. A unique partial index makes sure
   only one writer works on a slot at a time; a writer stuck for more than
   8 minutes gives up the slot. The first problem is written as soon as the
   lesson is classified, and the next one as soon as the current one is
   completed.
3. **Verification** (`services/runner/src/problems.ts`, `verifyProblem`). The
   problem is published only if all of these hold:
   - The examples type-check against the signature.
   - The validator accepts every authored input.
   - The baseline and the optimal reference agree with each other and with
     every authored expected output. This is checked on the examples, the
     edge cases and 40 random small inputs.
   - The optimal reference runs within budget, and gives the same result
     twice, on 3 large inputs.

   `efficiencyStage` is the runner's call: it is true only if the baseline
   exceeds `perfLimit = clamp(3·optimalMs + 500, 1.5s, 12s)`, whatever the
   model claimed. Anything that fails is rejected with a reason, and the
   author retries once with that feedback.
4. **Practice.**
   - **Run** executes the examples plus up to 4 cases of the learner's own.
     The reference answers the learner's cases.
   - **Submit** grades against the small suite for correctness and the large
     suite for time, giving one of: accepted, accepted_slow, wrong_answer,
     runtime_error, compile_error or time_limit.
   - A failed hidden test reveals only its kind and the error line. The
     edge case's `why` goes to the tutor and is never shown to the learner.
5. **Progression** (`lib/coding/policy.ts`, pure and tested). The LLM never
   grades and never decides what comes next.
   - **Credit.** Credit is capped by the deepest hint taken:
     `[1, .8, .65, .5, .35]` for levels 0–4.
     - Each failed submission costs 0.1, up to 0.4 in total.
     - Skipping the optimization stage multiplies credit by 0.7.
     - Revealing the solution gives 0.
     - If 60% or more of the code was pasted in from outside, credit is
       capped at 0.7.
   - **Next problem.**
     - Credit ≥ 0.75 moves on to a transfer problem.
     - Credit below that brings a reinforcement problem on the same concept,
       with a changed problem; at most 2 reinforcements.
     - After that, the concept is marked `review_later`.
   - **Mastery.** Mastery per concept is updated on completion, along with a
     spaced-review date.
6. **The live tutor** (`coachMoment` in `lib/coding/policy.ts`, `writeCoach` in `lib/coding/tutor.ts`). There is no chat
   box. The tutor sits beside the learner and checks in on its own, like a teacher looking over their shoulder.
   - **When it speaks.** Pure policy decides, never the model:
     - as the problem opens (it asks the learner to think before typing);
     - after a run that fails in a new way or first passes every example;
     - after every submission (a failure, the optimization stage, or a solve with a debrief question);
     - after 2 minutes of looking at the problem without typing or running (once per quiet stretch);
     - after 6 minutes and 40 or more edits without running.

     Check-ins it starts itself wait out a 90-second cooldown. It is quiet while a hint offer is on screen, says one
     thing at a time, and stops after 30 check-ins per attempt.
   - **How it reaches the page.** The workspace reports every 15 s while the page is in front of the learner, including
     how long they've been idle. That report, a run or a submission marks the tutor as "thinking" inside the same
     transaction. The words are written after the response, and the page polls every 2 s until they land.
   - **What it may say.** It reads the learner's code and latest results, and is capped at the hint level already
     unlocked. Below level 4, a check-in containing code is dropped, not shown. It never reveals hidden tests.
   - **Replies.** When the tutor ends with a question, the learner can answer it, up to 12 answers per attempt. Its
     reply follows the same rules.
   - **Hints.** Hints remain the explicit help that costs credit:
     - **When a hint is offered.** Offers come when the learner is stuck, and asking repeatedly doesn't produce them.
       "Stuck" means any of: 3 identical failures; 3 compile errors; 2 failed submissions; 8 active minutes without
       progress.
     - **When the next level unlocks.** Only after a new attempt (different code) or 3 more active minutes.

## Security model

- **Only the runner runs learner code.** Every execution is a fresh
  `learnspace-sandbox:1` container with these limits:
  - no network;
  - a read-only root filesystem and a small tmpfs;
  - uid 65534, with all capabilities dropped and a pids limit;
  - CPU, memory and wall-clock limits.

  A shared, gated executor caps the number of containers running at once
  (`RUNNER_CONCURRENCY`, default 4) and the queue behind them
  (`RUNNER_QUEUE`, default 32). When the queue is full, callers get 503.
- **Only the runner reads hidden tests.**
  - The app role can insert `practice.coding_problem_secrets` but cannot read
    it.
  - The app role cannot mark a problem verified, and cannot change a problem
    once it is verified.
  - The `learnspace_runner` role reads secrets and publishes problems, but
    cannot edit what was authored.

  All of this is enforced by grants and triggers, and covered by
  `packages/db/src/tests/run.ts`.
- **Request limits.** The app calls the runner with a bearer token
  (`RUNNER_TOKEN`). Code runs are rate-limited per user: 20 per minute and
  300 per hour.
- **Docker socket.** The runner drives Docker through the host socket, which
  is root-equivalent on that host. In production, give the runner a host of
  its own, or run sandboxes under gVisor (`SANDBOX_RUNTIME=runsc`).

## Honest limits

- **Focus mode can't lock the browser.** A web page cannot stop anyone
  switching tabs or opening another window. Focus mode is fullscreen plus
  bookkeeping:
  - working time, counted only while the page is visible, focused and
    recently used;
  - time away, with a resume screen after 30 s;
  - text pasted in from outside the editor.

  The server credits working time no faster than its own clock. Pasting
  affects credit; the learner is never accused of anything.
- **Problems are original, not LeetCode's.** LeetCode's problems and hidden
  tests aren't licensed for reuse. Problems are written fresh for the
  lesson's concepts and are trusted only because the runner verified them
  by execution. A variant check (Jaccard ≤ 0.6 against the learner's earlier
  problems) keeps reinforcement problems from being reworded copies.
- **Language support.** The references and generator are Python. Learners
  can write Python, JavaScript, Java or C++, through a per-language harness.

## Running it

- **With Compose.** `docker compose up -d` builds `learnspace-sandbox:1`
  (the `sandbox` service) and starts `runner` on :4100.
- **Configuration.**
  - The web app needs `RUNNER_URL` and `RUNNER_TOKEN`.
  - The runner needs `RUNNER_TOKEN` and `DATABASE_RUNNER_URL`, and
    optionally `SANDBOX_RUNTIME`, `SANDBOX_CPUS`, `RUNNER_CONCURRENCY` and
    `DOCKER_SOCKET`.
  - Without a runner, the Code tool reports that practice is unavailable.
- **Tests.**
  - `pnpm --filter @learnspace/runner test`: the sandbox, grading, and
    verification against the database.
  - `apps/web` `tests/coding-policy.test.ts`: the policy.
  - `tests/coding.integration.test.ts`: the full loop with a real database,
    a real runner and fake models.
